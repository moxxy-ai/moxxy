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

export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${(s % 60).toString().padStart(2, '0')}s`;
}

// Hard cap on the full argument-summary string. Joining lots of fields
// (especially MCP tools with `query`, `user_intent`, `design_type`, …)
// produces a multi-line wrap that dwarfs the rest of the chat. Cap at
// one terminal line worth and let the model's full input live in the
// event log if anyone wants the gory detail.
const ARG_SUMMARY_MAX = 90;
const VALUE_MAX = 28;

export function summarizeArgs(input: unknown): string {
  if (input == null) return '';
  if (typeof input === 'string') return truncate(oneLine(input), 60);
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
