import { spawn } from 'node:child_process';
import { logger } from '../logger.js';
import { parseAnthropicStreamJson } from './shared/stream-json.js';
import { writeMcpConfigFile } from './shared/mcp-config.js';
import type { AgentChunk, AgentContext, AgentRunner } from './types.js';

export interface ClaudeRunnerOptions {
  cliPath?: string;
  timeoutMs?: number;
  permissionMode?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan';
  appendSystemPrompt?: string;
}

export class ClaudeRunner implements AgentRunner {
  readonly name = 'claude';
  readonly supportsMcp = true;
  readonly supportsStreaming = true;
  readonly supportsSessionResume = true;

  constructor(private opts: ClaudeRunnerOptions = {}) {}

  async *run(prompt: string, ctx: AgentContext): AsyncIterable<AgentChunk> {
    const cli = this.opts.cliPath ?? 'claude';
    const timeoutMs = this.opts.timeoutMs ?? 300_000;

    const args: string[] = [];

    // 续接先前会话；新 session_id 会通过 stream-json 的 system.init 帧回灌
    if (ctx.agentSessionId) {
      args.push('--resume', ctx.agentSessionId);
    }

    args.push(
      '-p',
      prompt,
      '--output-format',
      'stream-json',
      '--include-partial-messages',
      '--verbose',
      '--permission-mode',
      this.opts.permissionMode ?? 'bypassPermissions',
    );

    if (ctx.mcpServers && Object.keys(ctx.mcpServers).length > 0) {
      args.push('--mcp-config', writeMcpConfigFile(ctx.mcpServers));
    }

    if (this.opts.appendSystemPrompt) {
      args.push('--append-system-prompt', this.opts.appendSystemPrompt);
    }

    logger.debug(
      { cli, argsCount: args.length, resume: ctx.agentSessionId },
      'spawning claude',
    );

    const proc = spawn(cli, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NO_COLOR: '1', CI: '1' },
    });

    const timer = setTimeout(() => {
      logger.warn('claude timeout, killing');
      proc.kill('SIGTERM');
    }, timeoutMs);

    ctx.abortSignal?.addEventListener('abort', () => {
      logger.warn('claude aborted by signal');
      proc.kill('SIGTERM');
    });

    let stderrBuf = '';
    proc.stderr.on('data', (d) => {
      const text = d.toString();
      stderrBuf += text;
      logger.debug({ stderr: text.slice(0, 300) }, 'claude stderr');
    });

    let sessionStarted = false;
    try {
      for await (const text of parseAnthropicStreamJson(proc.stdout, {
        onUnknown: (line) => logger.debug({ line: line.slice(0, 200) }, 'non-json line'),
        onSessionStart: (id) => {
          sessionStarted = true;
          ctx.onSessionStarted?.(id);
        },
      })) {
        yield { type: 'text', text };
      }
      const code: number = await new Promise((resolve) => proc.on('close', resolve));
      if (code !== 0) {
        // resume 失败时，让上层清掉失效的 session_id
        if (ctx.agentSessionId && !sessionStarted) {
          logger.warn({ sessionId: ctx.agentSessionId }, 'claude resume failed, invalidating');
          ctx.onSessionInvalid?.();
        }
        throw new Error(`Claude CLI exited ${code}: ${stderrBuf.slice(0, 500)}`);
      }
    } finally {
      clearTimeout(timer);
    }
  }
}
