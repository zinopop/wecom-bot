import { resolve } from 'node:path';
import { nanoid } from 'nanoid';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { MsgIdDedup } from './dedup.js';
import { sessionKey } from './types.js';
import type { IncomingMessage, Platform, SessionRef } from './types.js';
import type { AgentRunner, McpServerSpec } from '../agents/types.js';
import type { SessionStore } from './session-store.js';
import type { ChatSessionStore } from './chat-session-store.js';
import type { AttachmentsStore } from './attachments.js';

/**
 * 平台无关路由：接收来自任意 Platform 的 IncomingMessage，走 agent，流式回推。
 * 单会话串行队列（跨平台的会话用 sessionKey 区分）。
 */
export class MessageRouter {
  private queues = new Map<string, Promise<void>>();
  private dedup = new MsgIdDedup();

  constructor(
    private sessions: SessionStore,
    private chatSessions: ChatSessionStore,
    private attachments: AttachmentsStore,
    private agent: AgentRunner,
    private resolvePlatform: (name: string) => Platform,
  ) {}

  ingest = (msg: IncomingMessage): void => {
    const dedupKey = `${msg.ref.platform}:${msg.msgId}`;
    if (!this.dedup.check(dedupKey)) {
      logger.debug({ dedupKey }, 'duplicate msgId skipped');
      return;
    }

    this.sessions.remember(msg.ref);

    const trimmed = msg.text.trim();
    const hasAttachments = (msg.attachments?.length ?? 0) > 0;

    if (!trimmed && !hasAttachments) return;

    if (msg.ref.chatType === 'group' && config.groupOnlyAtMe && trimmed && !isAtMe(trimmed)) {
      return;
    }

    const text = stripAt(trimmed);

    if (text === '/reset' || text === '重置会话' || text === '/清空') {
      this.handleReset(msg).catch((err) => logger.error({ err }, 'reset failed'));
      return;
    }

    const key = sessionKey(msg.ref);
    const prev = this.queues.get(key) ?? Promise.resolve();
    const next = prev
      .then(() => this.handle(msg, text))
      .catch((err) => logger.error({ err }, 'handle failed'));
    this.queues.set(key, next);
  };

  private async handleReset(msg: IncomingMessage): Promise<void> {
    const key = sessionKey(msg.ref);
    const cleared = this.chatSessions.clear(key);
    const platform = this.resolvePlatform(msg.ref.platform);
    const reply = platform.replyStream(msg);
    await reply.stream(
      cleared > 0 ? '✅ 已清空会话记忆，下轮将重新开始。' : 'ℹ️ 当前没有会话记忆可清空。',
      true,
    );
  }

  private async handle(msg: IncomingMessage, text: string): Promise<void> {
    const key = sessionKey(msg.ref);
    const resumeId = this.agent.supportsSessionResume
      ? this.chatSessions.get(key, this.agent.name)
      : null;
    const replyId = nanoid(10);
    const prompt = buildPrompt(text, msg);

    logger.info(
      {
        platform: msg.ref.platform,
        agent: this.agent.name,
        prompt: prompt.slice(0, 120),
        attachments: msg.attachments?.length ?? 0,
        resume: resumeId ?? undefined,
        replyId,
      },
      'handling text',
    );

    const platform = this.resolvePlatform(msg.ref.platform);
    const reply = platform.replyStream(msg);

    await reply.stream('思考中...', false).catch(() => {});

    let buffer = '';
    let accumulated = '';
    let lastFlush = Date.now();

    const flush = async (finish: boolean) => {
      if (!buffer && !finish) return;
      accumulated += buffer;
      buffer = '';
      lastFlush = Date.now();
      try {
        await reply.stream(accumulated || '（无输出）', finish);
      } catch (e) {
        logger.warn({ e }, 'stream flush failed');
      }
    };

    try {
      for await (const chunk of this.agent.run(prompt, {
        session: msg.ref,
        mcpServers: this.buildMcpServers(msg.ref, replyId),
        agentSessionId: resumeId ?? undefined,
        onSessionStarted: (id) => {
          this.chatSessions.set(key, this.agent.name, id, config.agentSessionTtlMs);
        },
        onSessionInvalid: () => {
          this.chatSessions.clear(key, this.agent.name);
        },
      })) {
        if (chunk.type !== 'text') continue;
        buffer += chunk.text;
        if (Date.now() - lastFlush >= config.streamFlushMs) {
          await flush(false);
        }
      }

      // 最终 flush 前，捞出 agent 通过 MCP 放入的附件
      const pending = this.attachments.drain(replyId);
      for (const img of pending) {
        await reply.attachImage(img).catch((e) => logger.warn({ e }, 'attachImage failed'));
      }
      if (pending.length > 0) {
        logger.info({ replyId, count: pending.length }, 'attached images');
      }

      await flush(true);
    } catch (err) {
      logger.error({ err }, 'agent stream error');
      // 失败也要清残留
      this.attachments.drain(replyId);
      const m = err instanceof Error ? err.message : String(err);
      await reply
        .stream(`❌ 调用 ${this.agent.name} 失败：\n\`\`\`\n${m}\n\`\`\``, true)
        .catch(() => {});
    }
  }

  private buildMcpServers(
    ref: SessionRef,
    replyId: string,
  ): Record<string, McpServerSpec> | undefined {
    if (!this.agent.supportsMcp) return undefined;
    const tsx = resolve(process.cwd(), 'node_modules/tsx/dist/cli.mjs');
    return {
      reminder: {
        command: process.execPath,
        args: [tsx, resolve(process.cwd(), 'src/reminder/mcp-server.ts')],
        env: {
          REMINDER_DB_PATH: resolve(process.cwd(), config.reminderDbPath),
          PLATFORM: ref.platform,
          CHAT_TYPE: ref.chatType,
          CHAT_ID: ref.chatId ?? '',
          USER_ID: ref.userId,
        },
      },
      reply: {
        command: process.execPath,
        args: [tsx, resolve(process.cwd(), 'src/reply/mcp-server.ts')],
        env: {
          REPLY_ID: replyId,
          ATTACHMENTS_DIR: this.attachments.dirPath,
        },
      },
    };
  }
}

function buildPrompt(text: string, msg: IncomingMessage): string {
  if (!msg.attachments || msg.attachments.length === 0) return text;
  const list = msg.attachments
    .map((a) => `- [${a.type}] ${a.path}${a.bytes ? ` (${(a.bytes / 1024).toFixed(1)} KB)` : ''}`)
    .join('\n');
  const header = `用户随消息附带了 ${msg.attachments.length} 个附件（本地绝对路径，可直接用 Read 工具查看）：\n${list}`;
  return text ? `${header}\n\n用户文字：${text}` : header;
}

function isAtMe(content: string): boolean {
  return /^@\S+\s+/.test(content);
}

function stripAt(s: string): string {
  return s.replace(/^@\S+\s+/, '');
}
