import type { EventLogReader } from './log.js';
import type { ProviderMessage } from './provider.js';
import type { ToolDef } from './tool.js';

/**
 * Lazy tool loading (request-scoped tool selection). Mirrors the skill
 * lazy-load idiom: instead of sending every tool schema on every call, send a
 * small always-on core plus whatever the model has explicitly loaded, and put
 * a compact one-line index of the rest in the system prompt. The model calls
 * `load_tool({ name })` to pull a schema in before using it.
 *
 * "Loaded" state is derived from the log (the `load_tool` calls), not a
 * separate mutable store — so projection stays a pure function of the log, the
 * same property that makes elision and caching deterministic.
 */

/** Core tools always sent in full — the agent's baseline capability + the
 * loaders themselves. Everything else is lazy-loadable when gating is on. */
export const ALWAYS_ON_TOOLS: ReadonlySet<string> = new Set([
  'Read',
  'Write',
  'Edit',
  'Bash',
  'Grep',
  'Glob',
  'recall',
  'load_skill',
  'load_tool',
  'dispatch_agent',
]);

/** Tool names the model has loaded this session (from `load_tool` calls). */
export function loadedToolNames(log: EventLogReader): ReadonlySet<string> {
  const names = new Set<string>();
  for (const e of log.ofType('tool_call_requested')) {
    if (e.name !== 'load_tool') continue;
    const input = e.input as { name?: unknown } | null | undefined;
    if (input && typeof input === 'object' && typeof input.name === 'string') {
      names.add(input.name);
    }
  }
  return names;
}

function oneLine(s: string): string {
  return s.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

/** Above this many registered tools, lazy loading turns itself on unless the config says otherwise. */
export const LAZY_TOOLS_AUTO_THRESHOLD = 200;

/** Whether to gate tools: an explicit setting wins; unset means "only when the list is long". */
export function shouldGateTools(setting: boolean | undefined, toolCount: number): boolean {
  return setting ?? toolCount > LAZY_TOOLS_AUTO_THRESHOLD;
}

/** A family needs this many members before the index folds it into one line. */
const FAMILY_MIN = 4;

/** The prefix a tool shares with its siblings: its MCP server, or the word before the first underscore. */
function familyPrefix(name: string): string | null {
  const mcp = /^mcp__[^_]+(?:_[^_]+)*__/.exec(name);
  if (mcp) return mcp[0];
  const cut = name.indexOf('_');
  return cut > 0 ? name.slice(0, cut + 1) : null;
}

/** The tools a `load_tool` name stands for: one tool, or a family written as `prefix*`. */
export function matchLoadableTools<T extends { readonly name: string }>(name: string, tools: ReadonlyArray<T>): T[] {
  if (!name.endsWith('*')) return tools.filter((t) => t.name === name);
  const prefix = name.slice(0, -1);
  return prefix.length === 0 ? [] : tools.filter((t) => t.name.startsWith(prefix));
}

/** Compact index of not-yet-loaded tools: one line per family, one per tool outside a family. */
export function buildToolIndex(hidden: ReadonlyArray<ToolDef>): string {
  const families = new Map<string, string[]>();
  for (const t of hidden) {
    const prefix = familyPrefix(t.name);
    if (prefix === null) continue;
    const members = families.get(prefix);
    if (members) members.push(t.name);
    else families.set(prefix, [t.name]);
  }
  const listed = new Set<string>();
  const lines: string[] = [];
  for (const t of hidden) {
    const prefix = familyPrefix(t.name);
    const members = prefix === null ? undefined : families.get(prefix);
    if (prefix !== null && members && members.length >= FAMILY_MIN) {
      if (listed.has(prefix)) continue;
      listed.add(prefix);
      lines.push(`- **${prefix}*** (${members.length} tools: ${members.join(', ')})`);
    } else {
      lines.push(`- **${t.name}** — ${truncate(oneLine(t.description ?? ''), 100)}`);
    }
  }
  return (
    `## Loadable tools\n\n` +
    `These tools exist but their full schemas are not loaded right now. When a ` +
    `task needs one, call \`load_tool({ name: "<tool-name>" })\` first, then call ` +
    `the tool on the next turn. A line ending in \`*\` is a family: load all of it ` +
    `at once with its name, e.g. \`load_tool({ name: "computer_*" })\`.\n\n${lines.join('\n')}`
  );
}

function injectIntoSystem(
  messages: ReadonlyArray<ProviderMessage>,
  index: string,
): ProviderMessage[] {
  const out = messages.map((m) => m);
  const sysIdx = out.findIndex((m) => m.role === 'system');
  if (sysIdx >= 0) {
    const sys = out[sysIdx]!;
    const content = sys.content.map((b) =>
      b.type === 'text' ? { ...b, text: `${b.text}\n\n${index}` } : b,
    );
    // If there was no text block, append one.
    if (!sys.content.some((b) => b.type === 'text')) {
      content.push({ type: 'text', text: index });
    }
    out[sysIdx] = { role: 'system', content };
    return out;
  }
  return [{ role: 'system', content: [{ type: 'text', text: index }] }, ...out];
}

export interface GatedTools {
  readonly messages: ReadonlyArray<ProviderMessage>;
  readonly tools: ReadonlyArray<ToolDef>;
}

/**
 * Apply lazy tool gating: keep always-on + loaded tools in the request, move
 * the rest into a system-prompt index. No-op (returns inputs) when nothing is
 * gated, so the system prompt stays byte-stable on turns that load nothing.
 */
export function applyLazyTools(
  messages: ReadonlyArray<ProviderMessage>,
  tools: ReadonlyArray<ToolDef>,
  log: EventLogReader,
): GatedTools {
  const loaded = new Set<string>();
  for (const name of loadedToolNames(log)) for (const t of matchLoadableTools(name, tools)) loaded.add(t.name);
  // Single partition pass: each tool is either visible (always-on or loaded) or
  // hidden, never both — so one loop yields the exact same two arrays (same
  // elements, same input order) the prior pair of complementary `filter`s did,
  // at O(n) instead of O(2n) with two membership checks per tool.
  const visible: ToolDef[] = [];
  const hidden: ToolDef[] = [];
  for (const t of tools) {
    (ALWAYS_ON_TOOLS.has(t.name) || loaded.has(t.name) ? visible : hidden).push(t);
  }
  if (hidden.length === 0) return { messages, tools };
  return { messages: injectIntoSystem(messages, buildToolIndex(hidden)), tools: visible };
}
