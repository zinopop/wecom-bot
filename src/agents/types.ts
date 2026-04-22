import type { SessionRef } from '../core/types.js';

export interface McpServerSpec {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface AgentContext {
  session: SessionRef;
  mcpServers?: Record<string, McpServerSpec>;
  abortSignal?: AbortSignal;
  /**
   * 若提供，尝试以 agent 原生 session 机制续上先前对话（如 Claude `--resume <id>`）。
   */
  agentSessionId?: string;
  /**
   * agent 报告其最新 session_id 时调用（首次即为新建，续接时可能与旧的相同）。
   */
  onSessionStarted?: (agentSessionId: string) => void;
  /**
   * 当 agent 判定先前 session_id 不可用时调用，以便上层清理失效映射。
   */
  onSessionInvalid?: () => void;
}

export interface AgentChunk {
  type: 'text';
  text: string;
}

export interface AgentRunner {
  readonly name: string;
  readonly supportsMcp: boolean;
  readonly supportsStreaming: boolean;
  readonly supportsSessionResume: boolean;
  run(prompt: string, ctx: AgentContext): AsyncIterable<AgentChunk>;
}
