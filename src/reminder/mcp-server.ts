#!/usr/bin/env node
/**
 * Reminder MCP server (stdio)。被 agent CLI 以子进程方式启动。
 *
 * 环境变量（由 router 在 --mcp-config 注入）：
 *   REMINDER_DB_PATH   SQLite 文件绝对路径
 *   PLATFORM           来源平台 (wecom/lark/...)
 *   CHAT_TYPE          'single' | 'group'
 *   CHAT_ID            群 chatId，单聊留空
 *   USER_ID            当前会话的 userId
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { CronExpressionParser } from 'cron-parser';
import { ReminderStore } from './store.js';
import type { SessionRef } from '../core/types.js';

const dbPath = required('REMINDER_DB_PATH');
const ref: SessionRef = {
  platform: required('PLATFORM'),
  chatType: required('CHAT_TYPE') as 'single' | 'group',
  chatId: process.env.CHAT_ID || null,
  userId: required('USER_ID'),
};

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    process.stderr.write(`mcp-reminder: missing env ${name}\n`);
    process.exit(2);
  }
  return v;
}

const store = new ReminderStore(dbPath);
const server = new McpServer({ name: 'reminder', version: '0.2.0' });

server.tool(
  'schedule_reminder',
  '为当前会话安排一个提醒。二选一：oneshot_in_seconds（N 秒后一次性）或 cron_expr（标准 5 段 cron，如 "*/3 * * * *"）。',
  {
    content: z.string().describe('提醒内容，原样推送给用户'),
    oneshot_in_seconds: z.number().int().positive().optional(),
    cron_expr: z.string().optional(),
    expires_in_seconds: z.number().int().positive().optional().describe('cron 提醒的总有效期'),
  },
  async ({ content, oneshot_in_seconds, cron_expr, expires_in_seconds }) => {
    if (!oneshot_in_seconds && !cron_expr) {
      return {
        content: [{ type: 'text', text: '必须提供 oneshot_in_seconds 或 cron_expr 之一' }],
        isError: true,
      };
    }
    if (oneshot_in_seconds && cron_expr) {
      return {
        content: [{ type: 'text', text: 'oneshot_in_seconds 与 cron_expr 只能二选一' }],
        isError: true,
      };
    }
    try {
      if (oneshot_in_seconds) {
        const fireAt = Date.now() + oneshot_in_seconds * 1000;
        const r = store.createOneshot(ref, content, fireAt);
        return {
          content: [
            {
              type: 'text',
              text: `已安排一次性提醒\nID: ${r.id}\n触发时间: ${new Date(fireAt).toLocaleString('zh-CN')}\n内容: ${content}`,
            },
          ],
        };
      }
      CronExpressionParser.parse(cron_expr!);
      const expiresAt = expires_in_seconds ? Date.now() + expires_in_seconds * 1000 : null;
      const r = store.createCron(ref, content, cron_expr!, expiresAt);
      return {
        content: [
          {
            type: 'text',
            text: `已安排周期提醒\nID: ${r.id}\ncron: ${cron_expr}\n下次触发: ${new Date(r.next_fire_at).toLocaleString('zh-CN')}${expiresAt ? `\n有效期至: ${new Date(expiresAt).toLocaleString('zh-CN')}` : ''}\n内容: ${content}`,
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          { type: 'text', text: `安排失败: ${err instanceof Error ? err.message : String(err)}` },
        ],
        isError: true,
      };
    }
  },
);

server.tool('list_reminders', '列出当前用户的活动提醒', {}, async () => {
  const items = store.listForSession(ref.platform, ref.userId);
  if (items.length === 0) return { content: [{ type: 'text', text: '当前没有活动提醒' }] };
  const lines = items.map((r) => {
    const when = new Date(r.next_fire_at).toLocaleString('zh-CN');
    const k = r.kind === 'cron' ? `cron(${r.cron_expr})` : 'oneshot';
    return `- ${r.id} ${k} 下次:${when} 内容:${r.content.slice(0, 40)}`;
  });
  return { content: [{ type: 'text', text: lines.join('\n') }] };
});

server.tool(
  'cancel_reminder',
  '取消指定 ID 的提醒',
  { id: z.string() },
  async ({ id }) => {
    const ok = store.cancel(id, ref.platform, ref.userId);
    return {
      content: [{ type: 'text', text: ok ? `已取消 ${id}` : `未找到或无权取消 ${id}` }],
      isError: !ok,
    };
  },
);

await server.connect(new StdioServerTransport());
