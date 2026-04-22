import { spawn } from 'node:child_process';
import { logger } from '../logger.js';
import { writeMcpConfigFile } from './shared/mcp-config.js';
import type { AgentChunk, AgentContext, AgentRunner } from './types.js';

export interface GeminiRunnerOptions {
  cliPath?: string;
  model?: string;
  timeoutMs?: number;
  /** 透传 --yolo 等跳过权限确认；默认 true 以支持 headless 跑工具 */
  yolo?: boolean;
}

/**
 * Gemini CLI 适配器。
 *
 * 说明：
 * - `gemini -p` 将整段回答写到 stdout，**不是真流式**；这里按可用 chunk 吐出 stdout。
 * - MCP：Gemini CLI 支持 `--mcp-config`（兼容 Claude 的 JSON 结构），v1 接入。
 * - 模型容量问题（2.5-pro / 3.1-preview 经常 429 MODEL_CAPACITY_EXHAUSTED）属于上游，不在此处处理。
 */
export class GeminiRunner implements AgentRunner {
  readonly name = 'gemini';
  readonly supportsMcp = true;
  readonly supportsStreaming = false;
  readonly supportsSessionResume = false;

  constructor(private opts: GeminiRunnerOptions = {}) {}

  async *run(prompt: string, ctx: AgentContext): AsyncIterable<AgentChunk> {
    const cli = this.opts.cliPath ?? 'gemini';
    const timeoutMs = this.opts.timeoutMs ?? 300_000;

    const args: string[] = ['-p', prompt];
    if (this.opts.model) args.push('-m', this.opts.model);
    if (this.opts.yolo !== false) args.push('--yolo');

    if (ctx.mcpServers && Object.keys(ctx.mcpServers).length > 0) {
      args.push('--mcp-config', writeMcpConfigFile(ctx.mcpServers));
    }

    logger.debug({ cli, argsCount: args.length }, 'spawning gemini');

    const proc = spawn(cli, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NO_COLOR: '1', CI: '1' },
    });

    const timer = setTimeout(() => {
      logger.warn('gemini timeout, killing');
      proc.kill('SIGTERM');
    }, timeoutMs);

    ctx.abortSignal?.addEventListener('abort', () => proc.kill('SIGTERM'));

    let stderrBuf = '';
    proc.stderr.on('data', (d) => {
      const t = d.toString();
      stderrBuf += t;
      logger.debug({ stderr: t.slice(0, 300) }, 'gemini stderr');
    });

    try {
      for await (const chunk of proc.stdout) {
        const text = stripAnsi(chunk.toString('utf8'));
        if (text) yield { type: 'text', text };
      }
      const code: number = await new Promise((resolve) => proc.on('close', resolve));
      if (code !== 0) {
        throw new Error(`Gemini CLI exited ${code}: ${stderrBuf.slice(0, 500)}`);
      }
    } finally {
      clearTimeout(timer);
    }
  }
}

function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
}
