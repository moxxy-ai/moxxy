export function stringify(v: unknown): string {
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n) + '…';
}

/** Replace newlines + tabs with a single space so multi-line values
 *  don't wrap the tool-call header across many rows. */
export function oneLine(s: string): string {
  return s.replace(/[\r\n\t]+/g, ' ').replace(/  +/g, ' ').trim();
}

/** `12s` → `3m 04s` → `1h 02m`. Superset of the previously-duplicated
 *  copies (the hour branch came from StatusLine's variant). */
export function formatElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  if (totalSec < 60) return `${totalSec}s`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min < 60) return `${min}m ${sec.toString().padStart(2, '0')}s`;
  const hr = Math.floor(min / 60);
  const remMin = min % 60;
  return `${hr}h ${remMin.toString().padStart(2, '0')}m`;
}

/**
 * Compact token count for tree rows: `65.3k` for ≥ 1000, the raw count below
 * that. Returns `null` for null/negative input so callers can omit the segment
 * (e.g. a still-running agent with no total yet).
 */
export function formatTokensK(n: number | null | undefined): string | null {
  if (n == null || n < 0) return null;
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(1)}k`;
}

// Hard cap on the full argument-summary string. Joining lots of fields
// (especially MCP tools with `query`, `user_intent`, `design_type`, …)
// produces a multi-line wrap that dwarfs the rest of the chat. Cap at
// one terminal line worth and let the model's full input live in the
// event log if anyone wants the gory detail.
const ARG_SUMMARY_MAX = 90;
const VALUE_MAX = 28;
// Cap for a top-level string argument (the whole input is one string).
const STRING_ARG_MAX = 60;
// Cap for the one-line preview of the latest call in a live-tools block.
const PREVIEW_LINE_MAX = 100;

export function summarizeArgs(input: unknown): string {
  if (input == null) return '';
  if (typeof input === 'string') return truncate(oneLine(input), STRING_ARG_MAX);
  if (typeof input !== 'object') return String(input);
  const entries = Object.entries(input as Record<string, unknown>);
  if (entries.length === 0) return '';
  const joined = entries.map(([k, v]) => `${k}=${formatValue(v)}`).join(', ');
  return truncate(oneLine(joined), ARG_SUMMARY_MAX);
}

function formatValue(v: unknown): string {
  if (typeof v === 'string') return JSON.stringify(truncate(oneLine(v), VALUE_MAX));
  if (typeof v === 'number' || typeof v === 'boolean' || v === null) return String(v);
  try {
    return truncate(oneLine(JSON.stringify(v)), VALUE_MAX);
  } catch {
    return '[…]';
  }
}

function stringField(input: unknown, key: string): string | null {
  if (!input || typeof input !== 'object') return null;
  const value = (input as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim() ? oneLine(value) : null;
}

/**
 * A tool call split into the two parts a TABULAR surface needs: the tool's own
 * name, and what it was called on.
 *
 * {@link formatToolActivity} bakes a verb into one flat sentence ("Ran grep · …"),
 * which is right for a terminal line and wrong for a column layout — the verb
 * repeats down every row, and the name it is trying to introduce ends up in the
 * middle of the string where it cannot be aligned or weighted. The desktop's
 * trace lays these out as `name  detail`, so it needs them apart.
 *
 * `detail` deliberately carries NO verb and no leading separator; it is the
 * argument, phrased the same way `formatToolActivity` phrases it so the two
 * surfaces still describe a call identically.
 */
export function describeToolCall(
  name: string,
  input: unknown,
): { readonly name: string; readonly detail: string } {
  const normalized = name.toLowerCase();
  if (normalized === 'read') {
    return { name, detail: stringField(input, 'file_path') ?? 'file' };
  }
  if (normalized === 'grep') {
    const pattern = stringField(input, 'pattern') ?? 'pattern';
    const cwd = stringField(input, 'cwd');
    return { name, detail: `${JSON.stringify(pattern)}${cwd ? ` in ${cwd}` : ''}` };
  }
  if (normalized === 'glob') {
    return { name, detail: stringField(input, 'pattern') ?? 'files' };
  }
  if (normalized === 'bash') {
    return { name, detail: stringField(input, 'command') ?? 'command' };
  }
  if (normalized.includes('search')) {
    return { name, detail: stringField(input, 'query') ?? summarizeArgs(input) };
  }
  return { name, detail: summarizeArgs(input) };
}

/** Natural-language activity line shared by terminal and graphical channels. */
export function formatToolActivity(name: string, input: unknown, running: boolean): string {
  const normalized = name.toLowerCase();
  if (normalized === 'read') return `${running ? 'Reading' : 'Read'} ${stringField(input, 'file_path') ?? 'file'}`;
  if (normalized === 'grep') {
    const pattern = stringField(input, 'pattern') ?? 'pattern';
    const cwd = stringField(input, 'cwd');
    return `${running ? 'Searching for' : 'Searched for'} ${pattern}${cwd ? ` in ${cwd}` : ''}`;
  }
  if (normalized === 'glob') return `${running ? 'Listing' : 'Listed'} ${stringField(input, 'pattern') ?? 'files'}`;
  if (normalized === 'bash') return `${running ? 'Running' : 'Ran'} ${stringField(input, 'command') ?? 'command'}`;
  if (normalized.includes('search')) {
    return `${running ? 'Searching for' : 'Searched for'} ${stringField(input, 'query') ?? summarizeArgs(input)}`;
  }
  const summary = summarizeArgs(input);
  return `${running ? 'Running' : 'Ran'} ${name}${summary ? ` · ${summary}` : ''}`;
}

/**
 * Color the `◆` indicator by where the call came from so a glance
 * across the scrollback shows which subsystem is active — MCP tools
 * are cyan, in-process skills magenta, builtin tools green, anything
 * else (compactor, abort, plugin notes) dim gray. Pending / failed
 * states override these (yellow / red).
 */
export const DotColors = {
  mcp: 'cyan' as const,
  skill: 'magenta' as const,
  tool: 'green' as const,
  subagent: 'blue' as const,
  other: 'gray' as const,
};

export function dotColorForTool(toolName: string): string {
  if (toolName.startsWith('mcp__')) return DotColors.mcp;
  return DotColors.tool;
}

import type { LiveToolCall } from './types.js';

/**
 * Build the verb summary line for a live-tools block:
 *   "Reading 3 files, searching for 1 pattern, listing 2 directories…"
 *
 * Tools with the same name share one phrase; counts plural-aware. The
 * trailing ellipsis is appended only while the block is still open (in
 * flight); known built-in verbs switch to past tense once it settles.
 */
export function buildCompactSummary(
  calls: ReadonlyArray<LiveToolCall>,
  inFlight: boolean,
): string {
  if (calls.length === 0) return '';
  // Group by tool name preserving insertion order. Map keeps insertion order
  // for first-occurrence and we just bump counts on subsequent hits.
  const groups = new Map<string, { verb: string; one: string; other: string; count: number }>();
  for (const c of calls) {
    const existing = groups.get(c.request.name);
    if (existing) {
      existing.count += 1;
      continue;
    }
    groups.set(c.request.name, {
      verb: c.compact.verb,
      one: c.compact.noun.one,
      other: c.compact.noun.other,
      count: 1,
    });
  }
  const phrases: string[] = [];
  let first = true;
  for (const g of groups.values()) {
    const stateVerb = inFlight ? g.verb : completedCompactVerb(g.verb);
    const verb = first ? stateVerb : stateVerb.toLowerCase();
    const noun = g.count === 1 ? g.one : g.other;
    phrases.push(`${verb} ${g.count} ${noun}`);
    first = false;
  }
  const joined = phrases.join(', ');
  return inFlight ? `${joined}…` : joined;
}

/** Built-in compact verbs are gerunds; settled history reads more naturally in
 * the past tense. Unknown/plugin-provided phrases are kept verbatim. */
function completedCompactVerb(verb: string): string {
  const known: Readonly<Record<string, string>> = {
    Reading: 'Read',
    'Searching for': 'Searched for',
    'Searching the web for': 'Searched the web for',
    Listing: 'Listed',
    Waiting: 'Waited',
    Writing: 'Wrote',
    Editing: 'Edited',
  };
  return known[verb] ?? verb;
}

/**
 * One-line preview of the latest call in a live-tools block. Uses
 * `compact.previewKey` when set (e.g. "file_path"), falling back to the
 * generic input summary. Capped to fit on one terminal line.
 */
export function compactPreviewLine(call: LiveToolCall): string {
  const key = call.compact.previewKey;
  if (key) {
    const input = call.request.input as Record<string, unknown> | null;
    const v = input?.[key];
    if (typeof v === 'string') return truncate(oneLine(v), PREVIEW_LINE_MAX);
  }
  return summarizeArgs(call.request.input);
}
