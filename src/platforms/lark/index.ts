import type {
  IncomingMessage,
  OutgoingImage,
  Platform,
  ReplyHandle,
  SessionRef,
} from '../../core/types.js';
void (0 as unknown as OutgoingImage);

/**
 * 飞书（Lark）平台 stub。
 *
 * 实现思路（留给后续）：
 * - 鉴权：App ID + App Secret → tenant_access_token
 * - 接收消息：/event/v1 webhook 或 Long Connection（WebSocket）
 *   推荐 Long Connection：https://open.larkoffice.com/document/client-docs/long-connection
 * - 消息 API：/im/v1/messages，支持 text/post/interactive (card)
 * - 流式：Lark 卡片可通过 patch 更新；或直接分多条消息
 * - SessionRef 映射：
 *     chatType = 'group' if chat_id else 'single'
 *     userId = open_id
 *     chatId = chat_id (p2p 时同 chat_id，也算 single chat)
 */
export interface LarkConfig {
  appId: string;
  appSecret: string;
  encryptKey?: string;
  verificationToken?: string;
}

export class LarkPlatform implements Platform {
  readonly name = 'lark';

  constructor(_config: LarkConfig) {}

  async start(
    _onMessage: (m: IncomingMessage) => void,
    _onEnter?: (r: SessionRef) => void,
  ): Promise<void> {
    throw new Error('LarkPlatform: not implemented yet');
  }

  async stop(): Promise<void> {}

  replyStream(_msg: IncomingMessage): ReplyHandle {
    throw new Error('LarkPlatform.replyStream: not implemented');
  }

  async pushMarkdown(_ref: SessionRef, _content: string): Promise<void> {
    throw new Error('LarkPlatform.pushMarkdown: not implemented');
  }
}
