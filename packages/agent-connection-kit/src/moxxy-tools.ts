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
  const { text, images } = toolOutputForModel(outcome.output);
  const content: McpContent[] = [{ type: 'text', text }, ...images.map((image): McpContent => ({ type: 'image', data: image.data, mimeType: image.mediaType }))];
  return { content };
}

export function mcpToolsFrom(tools: ReadonlyArray<ToolDef>): McpTool[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputJsonSchema ?? zodToJsonSchema(tool.inputSchema),
  }));
}

const NO_TURN = 'No Moxxy turn is running, so the tool cannot run now.';

/**
 * The MCP handler for one turn: the agent calls a Moxxy tool and the turn runs
 * it through the permission flow. MCP calls carry no id, so each gets its own.
 * Agents read the list once, so it holds every tool of the conversation and
 * stays the same between modes; the turn refuses what its mode does not offer.
 */
export function moxxyToolsHandler(tools: ReadonlyArray<ToolDef>, host: Pick<AgentStepHost, 'runTool'>): McpToolHandler {
  const listed = mcpToolsFrom(tools);
  return {
    list: () => listed,
    call: async (name, input) => toMcpResult(await host.runTool({ callId: `mcp_${randomUUID()}`, name, input })),
  };
}

/** Between turns: the same list, so an agent that reads it then sees no change, and every call refused. */
export function idleToolsHandler(tools: ReadonlyArray<ToolDef>): McpToolHandler {
  return moxxyToolsHandler(tools, { runTool: async () => ({ ok: false, message: NO_TURN }) });
}

/** Whether two tool lists name the same tools, whatever their order. */
export function sameToolNames(a: ReadonlyArray<ToolDef>, b: ReadonlyArray<ToolDef>): boolean {
  const names = (tools: ReadonlyArray<ToolDef>) => tools.map((tool) => tool.name).sort().join('\n');
  return names(a) === names(b);
}

