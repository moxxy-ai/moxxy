import { randomUUID } from 'node:crypto';
import {
  toolOutputForModel,
  zodToJsonSchema,
  type AgentStepHost,
  type AgentToolOutcome,
  type Skill,
  type ToolDef,
} from '@moxxy/sdk';
import { LOAD_SKILL, readSkill, skillTool } from './agent-skills.js';
import type { McpCallResult, McpContent, McpTool, McpToolHandler } from './mcp-server.js';
import { CALL_TOOL, DESCRIBE_TOOLS, FIND_TOOLS, callCatalogTool, catalogTools, isCatalogTool } from './tool-catalog.js';

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

const ABOUT_MOXXY =
  'Moxxy is the app the person talks to you through. The tools of this server are its own: each runs in the ' +
  "person's Moxxy conversation, asks them first when their Moxxy settings say so, and shows in their chat.";

const ABOUT_BROWSER =
  "The browser_* tools drive Moxxy's browser. In the Moxxy desktop app its pages open in the browser panel next " +
  'to the chat, where the person watches you work and can take over; outside the desktop it is a browser with no ' +
  'window. It opens public http(s) pages. A page on this computer, such as an app you are building on ' +
  'localhost:5173, opens only after the person allows that exact address and port through browser_allow_site; ' +
  'other private addresses never open. Use it when seeing or acting on ' +
  'a real page helps, such as checking a site or filling in a form for the person. Whether to use it or your own ' +
  'tools is your choice.';

const ABOUT_CATALOG =
  `Moxxy's tools are reached through three of them: ${FIND_TOOLS} lists them by group and finds one by what it does, ` +
  `${DESCRIBE_TOOLS} shows a tool's input, and ${CALL_TOOL} runs it.`;

/** What the agent is told about Moxxy's tools as it connects; the browser only when its tools are lent. */
export function moxxyInstructions(toolNames: ReadonlyArray<string>, catalog = false): string {
  const browser = toolNames.some((name) => name.startsWith('browser_'));
  return [ABOUT_MOXXY, ...(catalog ? [ABOUT_CATALOG] : []), ...(browser ? [ABOUT_BROWSER] : [])].join('\n\n');
}

export interface MoxxyToolsOptions {
  /**
   * Lend the tools behind `find_tools` / `describe_tools` / `call_tool`, so
   * their full descriptions are not sent with every request (see tool-catalog.ts).
   */
  readonly catalog?: boolean;
}

/**
 * The MCP handler for one turn: the agent calls a Moxxy tool and the turn runs
 * it through the permission flow. MCP calls carry no id, so each gets its own.
 * Agents read the list once, so it holds every tool of the conversation and
 * stays the same between modes; the turn refuses what its mode does not offer.
 * The `skills` offered to the agent come as one more tool, `load_skill`.
 */
export function moxxyToolsHandler(
  tools: ReadonlyArray<ToolDef>,
  host: Pick<AgentStepHost, 'runTool'>,
  skills: ReadonlyArray<Skill> = [],
  options: MoxxyToolsOptions = {},
): McpToolHandler {
  const skill = skillTool(skills);
  const lent = options.catalog ? catalogTools(tools) : mcpToolsFrom(tools);
  const listed = skill ? [...lent, skill] : lent;
  const run = (name: string, input: unknown) => host.runTool({ callId: `mcp_${randomUUID()}`, name, input });
  return {
    instructions: moxxyInstructions([...tools.map((tool) => tool.name), ...(skill ? [skill.name] : [])], options.catalog && lent.length > 0),
    list: () => listed,
    call: async (name, input) => {
      if (skill && name === LOAD_SKILL) return readSkill(skills, input, (skillName) => run(LOAD_SKILL, { name: skillName }));
      if (options.catalog && isCatalogTool(name)) return callCatalogTool(tools, name, input, run, toMcpResult);
      return toMcpResult(await run(name, input));
    },
  };
}

/** Between turns: the same list, so an agent that reads it then sees no change, and every call refused. */
export function idleToolsHandler(tools: ReadonlyArray<ToolDef>, skills: ReadonlyArray<Skill> = [], options: MoxxyToolsOptions = {}): McpToolHandler {
  return moxxyToolsHandler(tools, { runTool: async () => ({ ok: false, message: NO_TURN }) }, skills, options);
}

/** A server name as agents compare it: case aside, and characters other than letters, digits, `_` and `-` as `_` (OpenCode's tool names). */
const serverKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
/** Moxxy names an MCP server's tools `mcp__<server>__<tool>`. */
const MCP_TOOL = /^mcp__(.+?)__/;

/**
 * The tools to lend without those of an MCP server the agent has itself: a
 * server set up both in Moxxy and in the agent would otherwise reach it twice.
 */
export function withoutOwnMcpServers(tools: ReadonlyArray<ToolDef>, ownServers: ReadonlyArray<string>): ToolDef[] {
  const own = new Set(ownServers.map(serverKey));
  return tools.filter((tool) => {
    const server = MCP_TOOL.exec(tool.name)?.[1];
    return server === undefined || !own.has(serverKey(server));
  });
}

/** Whether two tool lists name the same tools, whatever their order. */
export function sameToolNames(a: ReadonlyArray<ToolDef>, b: ReadonlyArray<ToolDef>): boolean {
  const names = (tools: ReadonlyArray<ToolDef>) => tools.map((tool) => tool.name).sort().join('\n');
  return names(a) === names(b);
}

