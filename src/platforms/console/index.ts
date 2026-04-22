import readline from 'node:readline';
import { nanoid } from 'nanoid';
import { logger } from '../../logger.js';
import type { IncomingMessage, OutgoingImage, Platform, ReplyHandle, SessionRef } from '../../core/types.js';

export class ConsolePlatform implements Platform {
  readonly name = 'console';
  private rl?: readline.Interface;

  async start(
    onMessage: (m: IncomingMessage) => void,
    _onEnter?: (r: SessionRef) => void,
  ): Promise<void> {
    this.rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    logger.info('console platform ready; type to chat, ctrl+d to quit');
    this.rl.on('line', (line) => {
      const text = line.trim();
      if (!text) return;
      onMessage({
        ref: { platform: 'console', chatType: 'single', chatId: null, userId: 'local' },
        msgId: nanoid(12),
        text,
        createdAt: Date.now(),
      });
    });
  }

  async stop(): Promise<void> {
    this.rl?.close();
  }

  replyStream(_msg: IncomingMessage): ReplyHandle {
    let lastPrintedLen = 0;
    return {
      async stream(text: string, finish: boolean): Promise<void> {
        const delta = text.slice(lastPrintedLen);
        lastPrintedLen = text.length;
        process.stdout.write(delta);
        if (finish) process.stdout.write('\n');
      },
      async attachImage(img: OutgoingImage): Promise<void> {
        process.stdout.write(
          `\n[image attached: ${img.base64.length} bytes base64, md5=${img.md5.slice(0, 8)}]\n`,
        );
      },
    };
  }

  async pushMarkdown(_ref: SessionRef, content: string): Promise<void> {
    process.stdout.write(`\n[push] ${content}\n`);
  }
}
