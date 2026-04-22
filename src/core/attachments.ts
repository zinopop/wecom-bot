import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { OutgoingImage } from './types.js';

/**
 * 跨进程的待发送附件队列。
 * 由 reply MCP server 写入（子进程），由 router 在本次回复结束前读出并清空（主进程）。
 * 用文件系统做 IPC；替代 HTTP 复杂度，靠 per-reply 唯一 replyId 隔离。
 */
export class AttachmentsStore {
  constructor(private dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  get dirPath(): string {
    return this.dir;
  }

  private pathFor(replyId: string): string {
    return join(this.dir, `${replyId}.json`);
  }

  append(replyId: string, img: OutgoingImage): void {
    const p = this.pathFor(replyId);
    mkdirSync(dirname(p), { recursive: true });
    let arr: OutgoingImage[] = [];
    if (existsSync(p)) {
      try {
        arr = JSON.parse(readFileSync(p, 'utf8')) as OutgoingImage[];
      } catch {
        // 损坏就覆盖
      }
    }
    arr.push(img);
    writeFileSync(p, JSON.stringify(arr));
  }

  drain(replyId: string): OutgoingImage[] {
    const p = this.pathFor(replyId);
    if (!existsSync(p)) return [];
    try {
      const arr = JSON.parse(readFileSync(p, 'utf8')) as OutgoingImage[];
      unlinkSync(p);
      return arr;
    } catch {
      try {
        unlinkSync(p);
      } catch {
        // ignore
      }
      return [];
    }
  }
}
