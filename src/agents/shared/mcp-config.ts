import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { McpServerSpec } from '../types.js';

/**
 * 把 MCP servers 字典写成 Claude CLI / Gemini CLI 接受的 JSON 文件。
 * 两者格式兼容：{ "mcpServers": { name: { command, args, env } } }。
 * 返回临时文件路径，调用方不必清理（OS 自然回收）。
 */
export function writeMcpConfigFile(servers: Record<string, McpServerSpec>): string {
  const dir = mkdtempSync(join(tmpdir(), 'wecom-bot-mcp-'));
  const path = join(dir, 'mcp.json');
  writeFileSync(path, JSON.stringify({ mcpServers: servers }));
  return path;
}
