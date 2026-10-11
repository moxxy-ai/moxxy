import { randomUUID } from 'node:crypto';
import {
  toolOutputForModel,
  zodToJsonSchema,
  type AgentStepHost,
  type AgentToolOutcome,
  type ToolDef,
} from '@moxxy/sdk';
import type { McpCallResult, McpContent, McpTool, McpToolHandler } from './mcp-server.js';

/** A Moxxy tool result as an MCP tool result: what the model would see, pixels included. */
export function toMcpResult(outcome: AgentToolOutcome): McpCallResult {
  if (!outcome.ok) return { content: [{ type: 'text', text: outcome.message }], isError: true };
  const { text, image } = toolOutputForModel(outcome.output);
  const content: McpContent[] = [{ type: 'text', text }];
  if (image) content.push({ type: 'image', data: image.data, mimeType: image.mediaType });
  return { content };
}

export function mcpToolsFrom(tools: ReadonlyArray<ToolDef>): McpTool[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputJsonSchema ?? zodToJsonSchema(tool.inputSchema),
  }));
}

/**
 * The MCP handler for one turn: the agent calls a Moxxy tool and the turn runs
 * it through the permission flow. MCP calls carry no id, so each gets its own.
 */
export function moxxyToolsHandler(tools: ReadonlyArray<ToolDef>, host: Pick<AgentStepHost, 'runTool'>): McpToolHandler {
  const listed = mcpToolsFrom(tools);
  return {
    list: () => listed,
    call: async (name, input) => toMcpResult(await host.runTool({ callId: `mcp_${randomUUID()}`, name, input })),
  };
}
