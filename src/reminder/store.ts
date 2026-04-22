import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { nanoid } from 'nanoid';
import { CronExpressionParser } from 'cron-parser';
import type { SessionRef } from '../core/types.js';

export interface Reminder {
  id: string;
  platform: string;
  chat_type: 'single' | 'group';
  chat_id: string | null;
  user_id: string;
  content: string;
  kind: 'oneshot' | 'cron';
  fire_at: number | null;
  cron_expr: string | null;
  last_fired_at: number | null;
  next_fire_at: number;
  created_at: number;
  expires_at: number | null;
  status: 'active' | 'done' | 'cancelled';
}

export class ReminderStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.ensureSchema();
  }

  private ensureSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS reminders (
        id TEXT PRIMARY KEY,
        platform TEXT NOT NULL DEFAULT 'wecom',
        chat_type TEXT NOT NULL,
        chat_id TEXT,
        user_id TEXT NOT NULL,
        content TEXT NOT NULL,
        kind TEXT NOT NULL,
        fire_at INTEGER,
        cron_expr TEXT,
        last_fired_at INTEGER,
        next_fire_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER,
        status TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_reminders_due
        ON reminders(status, next_fire_at);
      CREATE INDEX IF NOT EXISTS idx_reminders_user
        ON reminders(platform, user_id, status);
    `);
    // 老库迁移：缺 platform 列时补上
    const cols = this.db.prepare(`PRAGMA table_info(reminders)`).all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === 'platform')) {
      this.db.exec(`ALTER TABLE reminders ADD COLUMN platform TEXT NOT NULL DEFAULT 'wecom'`);
    }
  }

  createOneshot(ref: SessionRef, content: string, fireAt: number): Reminder {
    const now = Date.now();
    const r: Reminder = {
      id: nanoid(8),
      platform: ref.platform,
      chat_type: ref.chatType,
      chat_id: ref.chatId,
      user_id: ref.userId,
      content,
      kind: 'oneshot',
      fire_at: fireAt,
      cron_expr: null,
      last_fired_at: null,
      next_fire_at: fireAt,
      created_at: now,
      expires_at: null,
      status: 'active',
    };
    this.insert(r);
    return r;
  }

  createCron(
    ref: SessionRef,
    content: string,
    cronExpr: string,
    expiresAt: number | null,
  ): Reminder {
    const now = Date.now();
    const interval = CronExpressionParser.parse(cronExpr, { currentDate: new Date(now) });
    const nextFireAt = interval.next().getTime();
    const r: Reminder = {
      id: nanoid(8),
      platform: ref.platform,
      chat_type: ref.chatType,
      chat_id: ref.chatId,
      user_id: ref.userId,
      content,
      kind: 'cron',
      fire_at: null,
      cron_expr: cronExpr,
      last_fired_at: null,
      next_fire_at: nextFireAt,
      created_at: now,
      expires_at: expiresAt,
      status: 'active',
    };
    this.insert(r);
    return r;
  }

  private insert(r: Reminder): void {
    this.db
      .prepare(
        `INSERT INTO reminders (id,platform,chat_type,chat_id,user_id,content,kind,fire_at,cron_expr,last_fired_at,next_fire_at,created_at,expires_at,status)
         VALUES (@id,@platform,@chat_type,@chat_id,@user_id,@content,@kind,@fire_at,@cron_expr,@last_fired_at,@next_fire_at,@created_at,@expires_at,@status)`,
      )
      .run(r);
  }

  dueNow(now = Date.now()): Reminder[] {
    return this.db
      .prepare(`SELECT * FROM reminders WHERE status='active' AND next_fire_at <= ?`)
      .all(now) as Reminder[];
  }

  markFired(id: string, firedAt: number): void {
    const r = this.get(id);
    if (!r) return;
    if (r.expires_at != null && firedAt >= r.expires_at) {
      this.db
        .prepare(`UPDATE reminders SET status='done', last_fired_at=? WHERE id=?`)
        .run(firedAt, id);
      return;
    }
    if (r.kind === 'oneshot') {
      this.db
        .prepare(`UPDATE reminders SET status='done', last_fired_at=? WHERE id=?`)
        .run(firedAt, id);
    } else {
      const interval = CronExpressionParser.parse(r.cron_expr!, {
        currentDate: new Date(firedAt),
      });
      const next = interval.next().getTime();
      this.db
        .prepare(`UPDATE reminders SET last_fired_at=?, next_fire_at=? WHERE id=?`)
        .run(firedAt, next, id);
    }
  }

  cancel(id: string, platform: string, userId: string): boolean {
    const res = this.db
      .prepare(
        `UPDATE reminders SET status='cancelled'
         WHERE id=? AND platform=? AND user_id=? AND status='active'`,
      )
      .run(id, platform, userId);
    return res.changes > 0;
  }

  listForSession(platform: string, userId: string): Reminder[] {
    return this.db
      .prepare(
        `SELECT * FROM reminders WHERE platform=? AND user_id=? AND status='active'
         ORDER BY next_fire_at ASC LIMIT 50`,
      )
      .all(platform, userId) as Reminder[];
  }

  get(id: string): Reminder | undefined {
    return this.db.prepare(`SELECT * FROM reminders WHERE id=?`).get(id) as Reminder | undefined;
  }

  reminderToRef(r: Reminder): SessionRef {
    return {
      platform: r.platform,
      chatType: r.chat_type,
      chatId: r.chat_id,
      userId: r.user_id,
    };
  }
}
