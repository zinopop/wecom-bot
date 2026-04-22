import { resolve } from 'node:path';
import { config } from './config.js';
import { logger } from './logger.js';
import { createAgent } from './agents/registry.js';
import { SessionStore } from './core/session-store.js';
import { ChatSessionStore } from './core/chat-session-store.js';
import { AttachmentsStore } from './core/attachments.js';
import { MessageRouter } from './core/router.js';
import { buildPlatforms } from './platforms/registry.js';
import { ReminderStore } from './reminder/store.js';
import { ReminderScheduler } from './reminder/scheduler.js';
import { startHttp } from './http/server.js';

async function main(): Promise<void> {
  const agent = createAgent();
  logger.info(
    {
      agent: agent.name,
      mcp: agent.supportsMcp,
      streaming: agent.supportsStreaming,
      sessionResume: agent.supportsSessionResume,
    },
    'agent selected',
  );

  const sessions = new SessionStore();
  const chatSessions = new ChatSessionStore(resolve(process.cwd(), config.reminderDbPath));
  const attachments = new AttachmentsStore(resolve(process.cwd(), config.pendingAttachmentsDir));

  const platforms = buildPlatforms();
  logger.info({ platforms: platforms.all().map((p) => p.name) }, 'platforms built');

  const router = new MessageRouter(sessions, chatSessions, attachments, agent, (name) =>
    platforms.get(name),
  );

  for (const p of platforms.all()) {
    await p.start(router.ingest, (ref) => sessions.remember(ref));
  }

  const reminderStore = new ReminderStore(resolve(process.cwd(), config.reminderDbPath));
  const scheduler = new ReminderScheduler(reminderStore, platforms);
  scheduler.start(1000);

  await startHttp(sessions, platforms);

  const shutdown = async (sig: string) => {
    logger.info({ sig }, 'shutting down');
    scheduler.stop();
    for (const p of platforms.all()) await p.stop().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.fatal({ err }, 'fatal');
  process.exit(1);
});
