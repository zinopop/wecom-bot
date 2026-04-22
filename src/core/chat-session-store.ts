import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

interface ChatSessionRow {
  session_key: string;
  agent: string;
  agent_session_id: string;
  last_used_at: number;
  expires_at: number | null;
}

/**
 * 持久化「会话 → agent 原生 session_id」的映射，用于 agent 续接多轮对话。
 *
 * 示例：Claude CLI 下，保存 session_key="wecom:u:zhengyu" → agent_session_id="<uuid>"，
 * 下次调用时以 `--resume <uuid>` 续上先前对话。
 *
 * TTL：超过 `expires_at` 的行视为失效（读时自动清理）。
 */
export class ChatSessionStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chat_sessions (
        session_key TEXT NOT NULL,
        agent TEXT NOT NULL,
        agent_session_id TEXT NOT NULL,
        last_used_at INTEGER NOT NULL,
        expires_at INTEGER,
        PRIMARY KEY (session_key, agent)
      );
    `);
  }

  get(sessionKey: string, agent: string): string | null {
    const row = this.db
      .prepare(
        `SELECT * FROM chat_sessions WHERE session_key=? AND agent=?`,
      )
      .get(sessionKey, agent) as ChatSessionRow | undefined;
    if (!row) return null;
    if (row.expires_at != null && Date.now() > row.expires_at) {
      this.clear(sessionKey, agent);
      return null;
    }
    return row.agent_session_id;
  }

  set(
    sessionKey: string,
    agent: string,
    agentSessionId: string,
    ttlMs: number | null = null,
  ): void {
    const now = Date.now();
    const expiresAt = ttlMs ? now + ttlMs : null;
    this.db
      .prepare(
        `INSERT INTO chat_sessions (session_key, agent, agent_session_id, last_used_at, expires_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(session_key, agent) DO UPDATE SET
           agent_session_id=excluded.agent_session_id,
           last_used_at=excluded.last_used_at,
           expires_at=excluded.expires_at`,
      )
      .run(sessionKey, agent, agentSessionId, now, expiresAt);
  }

  clear(sessionKey: string, agent?: string): number {
    const res = agent
      ? this.db
          .prepare(`DELETE FROM chat_sessions WHERE session_key=? AND agent=?`)
          .run(sessionKey, agent)
      : this.db.prepare(`DELETE FROM chat_sessions WHERE session_key=?`).run(sessionKey);
    return res.changes;
  }
}
