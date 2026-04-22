import { config } from '../config.js';
import type { AgentRunner } from './types.js';
import { ClaudeRunner } from './claude.js';
import { GeminiRunner } from './gemini.js';
import { CodexRunner } from './codex.js';

const AGENT_SYSTEM_PROMPT = [
  '你是运行在企业微信里的 AI 助手。',
  '你可以使用本地工具 (Bash/Read/Edit/Write/Grep/Glob 等) 来真实执行任务。',
  '你有以下 MCP 工具可用：',
  '  - reminder.schedule_reminder(content, oneshot_in_seconds | cron_expr, expires_in_seconds?)',
  '  - reminder.list_reminders()',
  '  - reminder.cancel_reminder(id)',
  '  - reply.send_image(path, alt_text?)  — 在本次回复末尾附带图片发给用户',
  '当用户要求定时/周期提醒时，必须调用 reminder 工具，不要口头答应。',
  'cron 使用标准 5 段格式（分 时 日 月 周），如 "*/3 * * * *"。',
  '当用户要求看图片、截图、生成图、查图等结果类输出时，调用 reply.send_image 真正发过去，不要只回文字说"图在 /xx"。',
  '用户消息如果带附件路径（"用户附件：- [image] /path/..."），用 Read 工具查看图片再回答。',
  '回复简洁，适合 IM 场景。',
].join('\n');

export function createAgent(): AgentRunner {
  const name = config.agent.name;
  switch (name) {
    case 'claude':
      return new ClaudeRunner({
        cliPath: config.agent.cliPath,
        timeoutMs: config.agent.timeoutMs,
        appendSystemPrompt: AGENT_SYSTEM_PROMPT,
      });
    case 'gemini':
      return new GeminiRunner({
        cliPath: config.agent.cliPath,
        model: config.agent.geminiModel,
        timeoutMs: config.agent.timeoutMs,
      });
    case 'codex':
      return new CodexRunner({
        cliPath: config.agent.cliPath,
        timeoutMs: config.agent.timeoutMs,
      });
    default:
      throw new Error(`unknown agent: ${name satisfies never}`);
  }
}
