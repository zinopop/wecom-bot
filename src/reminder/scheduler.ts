import { logger } from '../logger.js';
import type { Reminder, ReminderStore } from './store.js';
import type { PlatformRegistry } from '../platforms/registry.js';

export class ReminderScheduler {
  private timer?: NodeJS.Timeout;

  constructor(private store: ReminderStore, private platforms: PlatformRegistry) {}

  start(intervalMs = 1000): void {
    this.timer = setInterval(
      () => this.tick().catch((e) => logger.error({ e }, 'tick error')),
      intervalMs,
    );
    logger.info({ intervalMs }, 'reminder scheduler started');
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    for (const r of this.store.dueNow()) await this.fire(r);
  }

  private async fire(r: Reminder): Promise<void> {
    const md = `⏰ **提醒** (${r.id})\n\n${r.content}`;
    try {
      const platform = this.platforms.get(r.platform);
      await platform.pushMarkdown(this.store.reminderToRef(r), md);
      this.store.markFired(r.id, Date.now());
      logger.info({ id: r.id, platform: r.platform, kind: r.kind }, 'reminder fired');
    } catch (e) {
      logger.error({ e, id: r.id }, 'reminder push failed');
    }
  }
}
