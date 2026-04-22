/**
 * 平台无关的核心类型。所有 platform / agent / reminder 组件都依赖这里。
 */

export type ChatType = 'single' | 'group';

export interface SessionRef {
  platform: string;
  chatType: ChatType;
  chatId: string | null;
  userId: string;
}

export function sessionKey(ref: SessionRef): string {
  return ref.chatType === 'group' && ref.chatId
    ? `${ref.platform}:g:${ref.chatId}`
    : `${ref.platform}:u:${ref.userId}`;
}

export interface IncomingAttachment {
  type: 'image' | 'voice' | 'file';
  /** 本地磁盘绝对路径（平台已下载解密） */
  path: string;
  mime?: string;
  originalName?: string;
  bytes?: number;
}

export interface IncomingMessage {
  ref: SessionRef;
  msgId: string;
  text: string;
  attachments?: IncomingAttachment[];
  rawFrame?: unknown;
  createdAt: number;
}

/**
 * 出站图片；MCP 工具读完文件后写 base64+md5，平台 push 进回复帧。
 */
export interface OutgoingImage {
  base64: string;
  md5: string;
  altText?: string;
}

export interface ReplyHandle {
  /** 流式写入。finish=true 表示结束。 */
  stream(text: string, finish: boolean): Promise<void>;
  /** 在本次回复末尾附带图片。须在最后一次 stream(text, true) 之前调用。 */
  attachImage(img: OutgoingImage): Promise<void>;
}

export interface Platform {
  readonly name: string;
  start(onMessage: (m: IncomingMessage) => void, onEnter?: (r: SessionRef) => void): Promise<void>;
  stop(): Promise<void>;
  replyStream(msg: IncomingMessage): ReplyHandle;
  pushMarkdown(ref: SessionRef, content: string): Promise<void>;
}
