import { spawn } from 'node:child_process';
import { logger } from '../logger.js';
import type { AgentChunk, AgentContext, AgentRunner } from './types.js';

export interface CodexRunnerOptions {
  cliPath?: string;
  timeoutMs?: number;
  /** 传给 codex exec 的额外参数 */
  extraArgs?: string[];
}

/**
 * OpenAI Codex CLI 适配器。
 *
 * 基础实现：`codex exec "<prompt>"` headless 模式，stdout 为文本。
 * MCP 在 Codex 侧通过 ~/.codex/config.toml 或 `-c mcp_servers.<name>=...` 配置，
 * 此适配器暂不做 per-invocation MCP 注入（若需要，用 `--config-override` 或预写 TOML）。
 */
export class CodexRunner implements AgentRunner {
  readonly name = 'codex';
  readonly supportsMcp = false;
  readonly supportsStreaming = false;
  readonly supportsSessionResume = false;

  constructor(private opts: CodexRunnerOptions = {}) {}

  async *run(prompt: string, ctx: AgentContext): AsyncIterable<AgentChunk> {
    const cli = this.opts.cliPath ?? 'codex';
    const timeoutMs = this.opts.timeoutMs ?? 300_000;

    const args = ['exec', prompt, ...(this.opts.extraArgs ?? [])];
    logger.debug({ cli, argsCount: args.length }, 'spawning codex');

    const proc = spawn(cli, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NO_COLOR: '1', CI: '1' },
    });

    const timer = setTimeout(() => {
      logger.warn('codex timeout, killing');
      proc.kill('SIGTERM');
    }, timeoutMs);

    ctx.abortSignal?.addEventListener('abort', () => proc.kill('SIGTERM'));

    let stderrBuf = '';
    proc.stderr.on('data', (d) => {
      const t = d.toString();
      stderrBuf += t;
      logger.debug({ stderr: t.slice(0, 300) }, 'codex stderr');
    });

    try {
      for await (const chunk of proc.stdout) {
        const text = chunk.toString('utf8');
        if (text) yield { type: 'text', text };
      }
      const code: number = await new Promise((resolve) => proc.on('close', resolve));
      if (code !== 0) {
        throw new Error(`Codex CLI exited ${code}: ${stderrBuf.slice(0, 500)}`);
      }
    } finally {
      clearTimeout(timer);
    }
  }
}
