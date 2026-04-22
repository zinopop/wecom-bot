import type { SessionRef } from './types.js';
import { sessionKey } from './types.js';

interface SessionRecord extends SessionRef {
  lastSeen: number;
}

/**
 * 跨平台会话映射。由 platform 在首次看到用户消息时写入，
 * 供主动推送（HTTP /notify 通过别名解析）使用。
 */
export class SessionStore {
  private map = new Map<string, SessionRecord>();

  remember(ref: SessionRef): void {
    this.map.set(sessionKey(ref), { ...ref, lastSeen: Date.now() });
  }

  /**
   * 宽松查找：
   * - 传入 "wecom:u:zhengyu" 或 "wecom:g:chatid123" 直接查
   * - 传入 "zhengyu" 时按 userId 全平台查第一条
   */
  resolve(idOrKey: string): SessionRecord | undefined {
    if (this.map.has(idOrKey)) return this.map.get(idOrKey);
    for (const rec of this.map.values()) {
      if (rec.userId === idOrKey || rec.chatId === idOrKey) return rec;
    }
    return undefined;
  }

  list(): SessionRecord[] {
    return Array.from(this.map.values());
  }
}
