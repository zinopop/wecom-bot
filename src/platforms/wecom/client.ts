import AiBot, { generateReqId } from '@wecom/aibot-node-sdk';
import type { WsFrame } from '@wecom/aibot-node-sdk';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from '../../logger.js';
import { config } from '../../config.js';
import type {
  ChatType,
  IncomingAttachment,
  IncomingMessage,
  OutgoingImage,
  Platform,
  ReplyHandle,
  SessionRef,
} from '../../core/types.js';

export interface WecomConfig {
  botId: string;
  secret: string;
  heartbeatIntervalMs?: number;
}

export class WecomPlatform implements Platform {
  readonly name = 'wecom';
  private ws: any;

  constructor(private cfg: WecomConfig) {}

  async start(
    onMessage: (m: IncomingMessage) => void,
    onEnter?: (r: SessionRef) => void,
  ): Promise<void> {
    this.ws = new AiBot.WSClient({
      botId: this.cfg.botId,
      secret: this.cfg.secret,
      heartbeatInterval: this.cfg.heartbeatIntervalMs ?? 30_000,
      maxReconnectAttempts: -1,
    });

    this.ws.on('authenticated', () => logger.info('wecom authenticated'));
    this.ws.on('error', (err: unknown) => logger.error({ err }, 'wecom ws error'));
    this.ws.on('close', () => logger.warn('wecom ws closed'));

    const dispatch = async (frame: WsFrame<any>) => {
      try {
        const m = await this.toIncoming(frame);
        if (m) onMessage(m);
      } catch (e) {
        logger.error({ e }, 'wecom toIncoming failed');
      }
    };

    this.ws.on('message.text', dispatch);
    this.ws.on('message.mixed', dispatch);
    this.ws.on('message.image', dispatch);
    this.ws.on('message.voice', dispatch);
    this.ws.on('event.enter_chat', (frame: WsFrame<any>) => {
      const ref = toSessionRef(frame.body);
      if (ref && onEnter) onEnter(ref);
      this.ws.replyWelcome(frame, {
        msgtype: 'text',
        text: { content: '你好，我是 AI 助手。直接发消息就能聊。' },
      });
    });
    this.ws.on('event.template_card_event', (f: WsFrame) =>
      logger.info({ f: truncate(f) }, 'template_card_event (no-op)'),
    );
    this.ws.on('event.feedback_event', (f: WsFrame) =>
      logger.info({ f: truncate(f) }, 'feedback_event (no-op)'),
    );

    this.ws.connect();
    logger.info({ botId: this.cfg.botId }, 'wecom connecting');
  }

  async stop(): Promise<void> {
    this.ws?.disconnect?.();
  }

  replyStream(msg: IncomingMessage): ReplyHandle {
    const frame = msg.rawFrame as WsFrame<any>;
    const streamId = generateReqId('stream');
    const ws = this.ws;
    const pending: OutgoingImage[] = [];
    const target = resolveTarget(msg.ref);

    const sendPendingImages = async (): Promise<void> => {
      if (pending.length === 0) return;
      const todo = [...pending];
      pending.length = 0;
      for (const img of todo) {
        try {
          const buf = Buffer.from(img.base64, 'base64');
          const filename = `bot-${Date.now()}.png`;
          const uploaded = await ws.uploadMedia(buf, { type: 'image', filename });
          const mediaId = uploaded?.media_id ?? uploaded?.mediaId ?? uploaded;
          if (!mediaId) throw new Error('uploadMedia returned no media_id');
          await ws.sendMediaMessage(target, 'image', mediaId);
          logger.info({ bytes: buf.length, mediaId }, 'outbound image sent');
        } catch (e) {
          logger.error({ e }, 'outbound image failed');
        }
      }
    };

    return {
      async stream(text: string, finish: boolean): Promise<void> {
        await ws.replyStream(frame, streamId, text, finish);
        if (finish) await sendPendingImages();
      },
      async attachImage(img: OutgoingImage): Promise<void> {
        pending.push(img);
      },
    };
  }

  async pushMarkdown(ref: SessionRef, content: string): Promise<void> {
    await this.ws.sendMessage(resolveTarget(ref), {
      msgtype: 'markdown',
      markdown: { content },
    });
  }

  private async toIncoming(frame: WsFrame<any>): Promise<IncomingMessage | null> {
    const body = frame.body;
    if (!body) return null;
    const ref = toSessionRef(body);
    if (!ref) return null;

    let text = '';
    const attachments: IncomingAttachment[] = [];

    if (body.msgtype === 'text') {
      text = body.text?.content ?? '';
    } else if (body.msgtype === 'voice') {
      // WeCom 服务端已把语音转成文字，直接拿 content
      text = body.voice?.content ?? '';
      logger.info({ msgId: body.msgid, chars: text.length }, 'inbound voice transcribed');
    } else if (body.msgtype === 'image' && body.image?.url && body.image?.aeskey) {
      const att = await this.downloadImage(body.msgid, body.image);
      if (att) attachments.push(att);
    } else if (body.msgtype === 'mixed' && Array.isArray(body.mixed?.msg_item)) {
      const texts: string[] = [];
      for (const item of body.mixed.msg_item) {
        if (item.msgtype === 'text') {
          texts.push(item.text?.content ?? '');
        } else if (item.msgtype === 'voice') {
          texts.push(item.voice?.content ?? '');
        } else if (item.msgtype === 'image' && item.image?.url && item.image?.aeskey) {
          const att = await this.downloadImage(body.msgid, item.image);
          if (att) attachments.push(att);
        }
      }
      text = texts.join('\n');
    }
    text = text.trim();

    if (!text && attachments.length === 0) return null;

    return {
      ref,
      msgId: body.msgid,
      text,
      attachments: attachments.length > 0 ? attachments : undefined,
      rawFrame: frame,
      createdAt: (body.create_time ?? Math.floor(Date.now() / 1000)) * 1000,
    };
  }

  private async downloadImage(
    msgId: string,
    image: { url: string; aeskey: string; md5?: string },
  ): Promise<IncomingAttachment | null> {
    try {
      mkdirSync(config.inboundMediaDir, { recursive: true });
      const result = await this.ws.downloadFile(image.url, image.aeskey);
      const buffer: Buffer = result.buffer ?? result;
      const filename = result.filename || `${msgId}.jpg`;
      const path = join(config.inboundMediaDir, filename);
      writeFileSync(path, buffer);
      logger.info({ path, bytes: buffer.length }, 'inbound image saved');
      return { type: 'image', path, bytes: buffer.length, originalName: result.filename };
    } catch (e) {
      logger.error({ e, msgId }, 'inbound image download failed');
      return null;
    }
  }
}

function toSessionRef(body: any): SessionRef | null {
  if (!body?.from?.userid) return null;
  const chatType: ChatType = body.chattype === 'group' ? 'group' : 'single';
  return {
    platform: 'wecom',
    chatType,
    chatId: body.chatid ?? null,
    userId: body.from.userid,
  };
}

function resolveTarget(ref: SessionRef): string {
  return ref.chatType === 'group' && ref.chatId ? ref.chatId : ref.userId;
}

function truncate(o: unknown): unknown {
  try {
    const s = JSON.stringify(o);
    return s.length > 500 ? s.slice(0, 500) + '...' : s;
  } catch {
    return '[unserializable]';
  }
}
