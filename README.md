# wecom-bot

多平台（企业微信 / 飞书 / …）× 多 agent（Claude / Gemini / Codex）的 IM AI 助手框架。

企业微信长连接开箱即用；飞书 / 本地终端 stub 已就位，接口落实即可加新平台。

## 特性

- **多平台可插拔**：实现一个 `Platform` 接口即接入新 IM；可同时启用多个
- **多 agent 可插拔**：`AGENT=claude | gemini | codex` 切换，接口统一
- **流式回复**：Claude `stream-json` 真流式；其他整段刷新
- **MCP 工具注入**：每次调用生成临时 `mcp.json`，把 `platform/chatType/chatId/userId` 注入 MCP server 环境
- **真实提醒**：SQLite 持久化 + 进程内 tick，oneshot / cron / 过期 / 取消，平台无关回推
- **HTTP 主动推送**：Bearer Token 鉴权，`/notify` 自动根据 session 查到对应平台
- **msgid 幂等 + 单会话串行队列**

## 架构

```
                       ┌──────────────────── wecom-bot 进程 ────────────────────┐
                       │                                                         │
企微用户 ─WSS──▶   ┌──┤ WecomPlatform                                           │
                   │   │       │                                                 │
飞书用户 ─Webhook▶├──┤ LarkPlatform (stub)          ┌─ MessageRouter ─┐         │
                   │   │       │                     │                 │         │
本地 stdin ───────┘   │ ConsolePlatform ────────────┘                 ▼         │
                       │                                        AgentRunner      │
                       │                                        (claude/gemini/  │
                       │                                         codex spawn)    │
                       │                                                 │       │
                       │                                                 ▼       │
                       │                              Reminder MCP (stdio) ──▶ SQLite
                       │                                                         │
                       │  Scheduler (1s tick) ─读 SQLite─▶ Platform.pushMarkdown │
                       │                                                         │
                       │  Fastify /notify ─▶ Platform.pushMarkdown              │
                       └─────────────────────────────────────────────────────────┘
```

## 目录

```
src/
├── index.ts
├── config.ts
├── logger.ts
├── core/                         ← 平台无关核心
│   ├── types.ts                    SessionRef / IncomingMessage / ReplyHandle / Platform
│   ├── router.ts                   统一路由：msg → agent → platform reply
│   ├── dedup.ts                    msgid 幂等
│   └── session-store.ts            跨平台会话映射
├── platforms/                    ← IM 适配层
│   ├── types.ts
│   ├── registry.ts                 按 PLATFORMS env 启多个
│   ├── wecom/                      企业微信长连接
│   ├── lark/                       飞书 stub
│   └── console/                    本地终端调试
├── agents/                       ← LLM Agent 适配层
│   ├── types.ts
│   ├── registry.ts
│   ├── claude.ts                   Claude Code CLI（真流式 + MCP）
│   ├── gemini.ts                   Gemini CLI
│   ├── codex.ts                   OpenAI Codex CLI
│   └── shared/                     stream-json 解析 + MCP 配置生成
├── reminder/                     ← 真实提醒（跨平台）
│   ├── store.ts                    SQLite + cron 计算
│   ├── scheduler.ts                tick 回推
│   └── mcp-server.ts               stdio MCP：schedule/list/cancel
└── http/
    └── server.ts
docs/
└── wecom-api-memo.md
```

## 快速开始

### 1. 安装 agent CLI（至少一个）

根据你 `.env` 里 `AGENT=` 的选择装对应 CLI，并完成登录：

**Claude Code**（推荐，真流式 + MCP + 原生多轮）
```bash
# macOS / Linux 一键安装脚本
curl -fsSL https://claude.ai/install.sh | bash
# 或走 npm
npm install -g @anthropic-ai/claude-code

claude login                        # 首次登录（OAuth 或 API key）
claude --version                    # 验证
```
参考：https://docs.claude.com/en/docs/claude-code

**Gemini CLI**
```bash
npm install -g @google/gemini-cli
gemini                              # 首次走浏览器 OAuth 或设 GEMINI_API_KEY
```

**OpenAI Codex CLI**
```bash
npm install -g @openai/codex
codex                               # 首次 OAuth / OPENAI_API_KEY
```

### 2. 拉仓库、装依赖、配 env、起服务

```bash
git clone https://github.com/zinopop/wecom-bot.git
cd wecom-bot
cp .env.example .env
npm install
npm run dev
```

核心 env：

```
PLATFORMS=wecom           # 逗号分隔：wecom,lark,console
AGENT=claude              # claude | gemini | codex
WECOM_BOT_ID=...
WECOM_BOT_SECRET=...
HTTP_TOKEN=...
```

企微 `WECOM_BOT_ID` / `WECOM_BOT_SECRET` 在企业微信管理后台 → 智能机器人 → API 配置 → 长连接模式 获取。

## 扩展

### 新增平台

`src/platforms/<name>/index.ts` 里实现 `Platform`：

```ts
export interface Platform {
  readonly name: string;
  start(onMessage, onEnter?): Promise<void>;
  stop(): Promise<void>;
  replyStream(msg: IncomingMessage): ReplyHandle;
  pushMarkdown(ref: SessionRef, content: string): Promise<void>;
}
```

然后在 `platforms/registry.ts` 加 case，`.env` 里把 `PLATFORMS` 加上。

### 新增 agent

`src/agents/<name>.ts` 里实现 `AgentRunner`，在 `agents/registry.ts` 注册。

## HTTP API

```
GET  /health                                   无鉴权
GET  /sessions                                 Bearer
POST /notify { platform?, target, text }       Bearer
```

## 能力矩阵

| Agent | 真流式 | MCP | 提醒 |
|---|---|---|---|
| Claude | ✅ | ✅ | ✅ |
| Gemini | ❌ | ✅ | ✅ |
| Codex | ❌ | ⚠️ | ❌ |

| Platform | 状态 |
|---|---|
| wecom | ✅ 生产可用 |
| console | ✅ 本地调试 |
| lark | 🚧 stub，接口已就位 |

## 路线图

- [x] 多平台抽象 + wecom 首发
- [x] 多 agent 抽象（claude/gemini/codex）
- [x] 真实提醒（SessionRef 化，跨平台回推）
- [x] msgid 幂等
- [ ] 飞书平台实现
- [ ] 多轮对话上下文（claude `--resume`）
- [ ] 用户白名单 / 平台级 ACL
- [ ] Dockerfile
