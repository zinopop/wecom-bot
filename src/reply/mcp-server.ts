#!/usr/bin/env node
/**
 * Reply MCP server (stdio)。被 agent CLI 以子进程方式启动，提供"影响本次回复"的工具。
 *
 * 环境变量（由 router 在 --mcp-config 里注入）：
 *   REPLY_ID          本次回复的唯一 ID（router 和本进程共享）
 *   ATTACHMENTS_DIR   附件队列目录（router 最后 drain 该目录下 `${REPLY_ID}.json`）
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { AttachmentsStore } from '../core/attachments.js';

const replyId = required('REPLY_ID');
const attachmentsDir = required('ATTACHMENTS_DIR');

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    process.stderr.write(`mcp-reply: missing env ${name}\n`);
    process.exit(2);
  }
  return v;
}

const store = new AttachmentsStore(attachmentsDir);
const server = new McpServer({ name: 'reply', version: '0.1.0' });

server.tool(
  'send_image',
  '在本次回复末尾附带一张图片发给用户。图片 ≤10MB，png/jpg/gif/webp。调用后仍可继续用文字回答，图片会和最终文字一起发出。',
  {
    path: z.string().describe('图片文件的绝对路径'),
    alt_text: z.string().optional().describe('无障碍替代文字（企微暂不展示，仅便于日志）'),
  },
  async ({ path, alt_text }) => {
    if (!existsSync(path)) {
      return { content: [{ type: 'text', text: `文件不存在: ${path}` }], isError: true };
    }
    const stat = statSync(path);
    if (stat.size > 10 * 1024 * 1024) {
      return {
        content: [{ type: 'text', text: `图片过大 (${(stat.size / 1024 / 1024).toFixed(2)} MB > 10 MB)` }],
        isError: true,
      };
    }
    const buf = readFileSync(path);
    const md5 = createHash('md5').update(buf).digest('hex');
    const base64 = buf.toString('base64');
    store.append(replyId, { base64, md5, altText: alt_text });
    return {
      content: [
        {
          type: 'text',
          text: `图片已入队本次回复 (${(stat.size / 1024).toFixed(1)} KB, md5: ${md5.slice(0, 8)}...)`,
        },
      ],
    };
  },
);

await server.connect(new StdioServerTransport());
