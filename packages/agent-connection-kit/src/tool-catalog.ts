import { zodToJsonSchema, type AgentToolOutcome, type ToolDef } from '@moxxy/sdk';
import { LOAD_UPFRONT } from './agent-skills.js';
import type { McpCallResult, McpTool } from './mcp-server.js';

/**
 * Moxxy's tools behind three small ones. Lent one by one, every tool's full
 * description rides along in each request the agent makes; behind the catalog
 * the agent sees the groups, looks a tool up when it wants one and runs it
 * through `call_tool`, which runs the real tool in the turn, so the chat shows
 * that tool. `find_tools` and `describe_tools` only read the list: they run
 * nothing and show nothing.
 */
export const FIND_TOOLS = 'find_tools';
export const DESCRIBE_TOOLS = 'describe_tools';
export const CALL_TOOL = 'call_tool';
const CATALOG_TOOLS = new Set([FIND_TOOLS, DESCRIBE_TOOLS, CALL_TOOL]);

/** Claude Code cuts a tool description at 2048 characters (4096 from 2.1.296); the catalog stays under that. */
const DESCRIPTION_LIMIT = 2000;
const FOUND_LIMIT = 8;
const SUMMARY_LIMIT = 160;
/** Names shown per group, fewer while the catalog would not fit. */
const NAMES_PER_GROUP = [Infinity, 12, 6, 3, 0];
const MCP_TOOL = /^mcp__(.+?)__(.+)$/;

const FIND_INTRO =
  "Find one of the person's Moxxy tools. Moxxy is the app the person talks to you through; its tools run in their " +
  'Moxxy conversation. Call this with words for what you need, read the input of a tool with describe_tools, ' +
  'then run it with call_tool. The tools, by group:';

interface Group {
  readonly label: string;
  readonly shortNames: string[];
}

export function isCatalogTool(name: string): boolean {
  return CATALOG_TOOLS.has(name);
}

/** The three tools the agent is lent in place of `tools`; none when there is no tool to lend. */
export function catalogTools(tools: ReadonlyArray<ToolDef>): McpTool[] {
  if (tools.length === 0) return [];
  return [
    {
      name: FIND_TOOLS,
      description: catalogDescription(tools),
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Words for what the tool should do, such as "send an email" or "open a web page".' },
          limit: { type: 'number', description: `How many tools to return, ${FOUND_LIMIT} when left out.` },
        },
        required: ['query'],
      },
      _meta: LOAD_UPFRONT,
    },
    {
      name: DESCRIBE_TOOLS,
      description: "Read the full description and input schema of Moxxy tools, by the names find_tools gave. Read a tool's input before you call it.",
      inputSchema: {
        type: 'object',
        properties: { names: { type: 'array', items: { type: 'string' }, description: 'Full tool names, as find_tools gave them.' } },
        required: ['names'],
      },
      _meta: LOAD_UPFRONT,
    },
    {
      name: CALL_TOOL,
      description: 'Run one of the Moxxy tools, by its full name, with the arguments its input schema asks for.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'The full tool name, as find_tools gave it.' },
          arguments: { type: 'object', description: "The tool's arguments, as describe_tools shows its input.", additionalProperties: true },
        },
        required: ['name'],
      },
      _meta: LOAD_UPFRONT,
    },
  ];
}

/** The answer to a call of one of the catalog tools; `run` runs a real tool in the turn. */
export async function callCatalogTool(
  tools: ReadonlyArray<ToolDef>,
  name: string,
  input: unknown,
  run: (name: string, input: unknown) => Promise<AgentToolOutcome>,
  toResult: (outcome: AgentToolOutcome) => McpCallResult,
): Promise<McpCallResult> {
  const args = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  if (name === FIND_TOOLS) return text(find(tools, String(args.query ?? ''), Number(args.limit) || FOUND_LIMIT));
  if (name === DESCRIBE_TOOLS) return text(JSON.stringify(describe(tools, Array.isArray(args.names) ? args.names.map(String) : [])));
  const target = String(args.name ?? '');
  if (!tools.some((tool) => tool.name === target)) {
    return { content: [{ type: 'text', text: `No Moxxy tool is named "${target}". Call ${FIND_TOOLS} to find the one you need.` }], isError: true };
  }
  return toResult(await run(target, args.arguments ?? {}));
}

function text(value: string): McpCallResult {
  return { content: [{ type: 'text', text: value }] };
}

function catalogDescription(tools: ReadonlyArray<ToolDef>): string {
  const groups = groupsOf(tools);
  for (const limit of NAMES_PER_GROUP) {
    const lines = groups.map((group) => lineOf(group, limit));
    const description = `${FIND_INTRO}\n${lines.join('\n')}`;
    if (description.length <= DESCRIPTION_LIMIT) return description;
  }
  // Too many groups even without names: as many as fit, and a count of the rest.
  let description = FIND_INTRO;
  for (const [index, group] of groups.entries()) {
    const line = `\n${lineOf(group, 0)}`;
    const more = `\n- and ${groups.length - index} more groups: call ${FIND_TOOLS} to search them.`;
    if (description.length + line.length + more.length > DESCRIPTION_LIMIT) return description + more;
    description += line;
  }
  return description;
}

function lineOf(group: Group, limit: number): string {
  const count = group.shortNames.length;
  if (group.label === '') return `- ${group.shortNames.join(', ')}`;
  if (limit === 0) return `- ${group.label} (${count})`;
  const shown = group.shortNames.slice(0, limit).join(', ');
  return `- ${group.label} (${count}): ${shown}${count > limit ? ', …' : ''}`;
}

/** Tools by MCP server, or by the word before the first `_` when two or more share it; the rest in one line. */
function groupsOf(tools: ReadonlyArray<ToolDef>): Group[] {
  const prefixCount = new Map<string, number>();
  for (const tool of tools) {
    if (MCP_TOOL.test(tool.name)) continue;
    const prefix = tool.name.split('_')[0] ?? tool.name;
    if (prefix !== tool.name) prefixCount.set(prefix, (prefixCount.get(prefix) ?? 0) + 1);
  }
  const groups = new Map<string, Group>();
  const add = (label: string, shortName: string) => {
    const group = groups.get(label) ?? { label, shortNames: [] };
    group.shortNames.push(shortName);
    groups.set(label, group);
  };
  for (const tool of tools) {
    const mcp = MCP_TOOL.exec(tool.name);
    if (mcp) {
      add(mcp[1] ?? '', mcp[2] ?? tool.name);
      continue;
    }
    const prefix = tool.name.split('_')[0] ?? tool.name;
    if ((prefixCount.get(prefix) ?? 0) >= 2) add(prefix, tool.name.slice(prefix.length + 1));
    else add('', tool.name);
  }
  // Sorted, so the catalog reads the same however the tools were registered (an
  // MCP server attaching late reorders them) and the agent's prompt cache keeps
  // matching; the ungrouped tools last, so the groups read first.
  for (const group of groups.values()) group.shortNames.sort();
  return [...groups.values()].sort((a, b) => Number(a.label === '') - Number(b.label === '') || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
}

const wordsOf = (value: string) => value.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 3);

function find(tools: ReadonlyArray<ToolDef>, query: string, limit: number): string {
  const asked = wordsOf(query);
  const scored = tools
    .map((tool, index) => {
      const nameWords = new Set(wordsOf(tool.name));
      const descriptionWords = new Set(wordsOf(tool.description));
      const score = asked.reduce((sum, word) => sum + (nameWords.has(word) ? 3 : 0) + (descriptionWords.has(word) ? 1 : 0), 0);
      return { tool, index, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, Math.max(1, limit));
  if (scored.length === 0) return `No Moxxy tool matched "${query}". Try other words; the groups are listed in ${FIND_TOOLS}'s description.`;
  return scored.map(({ tool }) => `${tool.name} — ${summaryOf(tool.description)}`).join('\n');
}

function summaryOf(description: string): string {
  const first = description.split(/(?<=[.!?])\s/)[0] ?? description;
  return first.length > SUMMARY_LIMIT ? `${first.slice(0, SUMMARY_LIMIT - 1)}…` : first;
}

function describe(tools: ReadonlyArray<ToolDef>, names: ReadonlyArray<string>) {
  const known = names.flatMap((name) => {
    const tool = tools.find((candidate) => candidate.name === name);
    return tool ? [{ name: tool.name, description: tool.description, inputSchema: tool.inputJsonSchema ?? zodToJsonSchema(tool.inputSchema) }] : [];
  });
  const unknown = names.filter((name) => !tools.some((tool) => tool.name === name));
  return unknown.length > 0 ? { tools: known, unknown } : { tools: known };
}
