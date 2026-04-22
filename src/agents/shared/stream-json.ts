import readline from 'node:readline';
import type { Readable } from 'node:stream';

export interface ParseOptions {
  onUnknown?: (line: string) => void;
  /** 收到 `{type:"system", subtype:"init", session_id, ...}` 时调用 */
  onSessionStart?: (sessionId: string) => void;
}

/**
 * 解析 Anthropic stream-json（Claude Code CLI `--output-format stream-json --include-partial-messages`）。
 * 按 text_delta 产出字符串；副作用回调见 ParseOptions。
 */
export async function* parseAnthropicStreamJson(
  stdout: Readable,
  opts: ParseOptions = {},
): AsyncGenerator<string, void, void> {
  const rl = readline.createInterface({ input: stdout, crlfDelay: Infinity });

  let usedPartial = false;
  let assistantBuffered = '';

  for await (const line of rl) {
    if (!line.trim()) continue;
    let evt: any;
    try {
      evt = JSON.parse(line);
    } catch {
      opts.onUnknown?.(line);
      continue;
    }

    if (evt.type === 'system' && evt.subtype === 'init' && typeof evt.session_id === 'string') {
      opts.onSessionStart?.(evt.session_id);
      continue;
    }

    if (evt.type === 'stream_event') {
      const inner = evt.event;
      if (
        inner?.type === 'content_block_delta' &&
        inner.delta?.type === 'text_delta' &&
        typeof inner.delta.text === 'string' &&
        inner.delta.text.length > 0
      ) {
        usedPartial = true;
        yield inner.delta.text;
      }
    } else if (evt.type === 'assistant' && !usedPartial) {
      const content = evt.message?.content;
      if (Array.isArray(content)) {
        const text = content
          .filter((c: any) => c.type === 'text')
          .map((c: any) => c.text)
          .join('');
        if (text && text !== assistantBuffered) {
          const delta = text.startsWith(assistantBuffered)
            ? text.slice(assistantBuffered.length)
            : text;
          assistantBuffered = text;
          if (delta) yield delta;
        }
      }
    } else if (evt.type === 'result' && evt.subtype && evt.subtype !== 'success') {
      throw new Error(`claude result: ${evt.subtype} ${evt.error ?? ''}`);
    }
  }
}
