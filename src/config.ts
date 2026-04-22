import 'dotenv/config';

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

function optInt(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number(v);
  if (Number.isNaN(n)) throw new Error(`Env ${name} must be a number`);
  return n;
}

function optBool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v == null) return fallback;
  return v === 'true' || v === '1';
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

type AgentName = 'claude' | 'gemini' | 'codex';
function agentName(): AgentName {
  const v = (process.env.AGENT ?? 'claude').toLowerCase();
  if (v !== 'claude' && v !== 'gemini' && v !== 'codex') {
    throw new Error(`Unsupported AGENT=${v}. Use claude | gemini | codex`);
  }
  return v;
}

function platforms(): string[] {
  return (process.env.PLATFORMS ?? 'wecom')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

const wecomBotId = process.env.WECOM_BOT_ID;
const wecomSecret = process.env.WECOM_BOT_SECRET;

const larkAppId = process.env.LARK_APP_ID;
const larkSecret = process.env.LARK_APP_SECRET;

export const config = {
  platforms: platforms(),
  wecom:
    wecomBotId && wecomSecret
      ? { botId: wecomBotId, secret: wecomSecret, heartbeatIntervalMs: 30_000 }
      : undefined,
  lark:
    larkAppId && larkSecret
      ? {
          appId: larkAppId,
          appSecret: larkSecret,
          encryptKey: process.env.LARK_ENCRYPT_KEY,
          verificationToken: process.env.LARK_VERIFICATION_TOKEN,
        }
      : undefined,
  agent: {
    name: agentName(),
    cliPath: process.env.AGENT_CLI_PATH,
    timeoutMs: optInt('AGENT_TIMEOUT_MS', 300_000),
    geminiModel: optional('GEMINI_MODEL', 'gemini-2.5-flash'),
  },
  http: {
    host: optional('HTTP_HOST', '127.0.0.1'),
    port: optInt('HTTP_PORT', 3000),
    token: required('HTTP_TOKEN'),
  },
  logLevel: optional('LOG_LEVEL', 'info'),
  groupOnlyAtMe: optBool('GROUP_ONLY_AT_ME', true),
  streamFlushMs: optInt('STREAM_FLUSH_MS', 300),
  reminderDbPath: optional('REMINDER_DB_PATH', 'data/reminders.db'),
  /** agent 原生 session 记忆的保留时间（默认 24h），过期后自动丢弃重开 */
  agentSessionTtlMs: optInt('AGENT_SESSION_TTL_MS', 24 * 60 * 60 * 1000),
  /** 出站图片临时队列目录（reply MCP server 写入 → router 读出） */
  pendingAttachmentsDir: optional('PENDING_ATTACHMENTS_DIR', 'data/pending-attachments'),
  /** 入站图片/语音/文件下载存放目录 */
  inboundMediaDir: optional('INBOUND_MEDIA_DIR', 'data/inbound-media'),
};
