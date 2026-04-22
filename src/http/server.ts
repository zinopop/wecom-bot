import Fastify from 'fastify';
import { config } from '../config.js';
import { logger } from '../logger.js';
import type { SessionStore } from '../core/session-store.js';
import type { PlatformRegistry } from '../platforms/registry.js';

export async function startHttp(sessions: SessionStore, platforms: PlatformRegistry): Promise<void> {
  const app = Fastify({ logger: false });

  app.addHook('onRequest', async (req, reply) => {
    if (req.url === '/health') return;
    if (req.headers.authorization !== `Bearer ${config.http.token}`) {
      reply.code(401).send({ error: 'unauthorized' });
    }
  });

  app.get('/health', async () => ({ ok: true }));

  app.get('/sessions', async () => ({ sessions: sessions.list() }));

  app.post<{
    Body: { platform?: string; target: string; text: string };
  }>('/notify', async (req, reply) => {
    const { platform, target, text } = req.body ?? ({} as any);
    if (!target || !text) {
      reply.code(400).send({ error: 'target and text required' });
      return;
    }
    const resolved = sessions.resolve(
      platform ? `${platform}:${target.includes(':') ? target : `u:${target}`}` : target,
    ) ?? sessions.resolve(target);
    if (!resolved) {
      reply.code(404).send({ error: 'session not found; user needs to chat first' });
      return;
    }
    try {
      const p = platforms.get(resolved.platform);
      await p.pushMarkdown(resolved, text);
      return { ok: true, sent_to: resolved };
    } catch (err) {
      logger.error({ err }, 'notify failed');
      reply.code(500).send({ error: String(err) });
    }
  });

  await app.listen({ host: config.http.host, port: config.http.port });
  logger.info({ host: config.http.host, port: config.http.port }, 'http listening');
}
