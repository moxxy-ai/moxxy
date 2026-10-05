import type { MoxxyEvent } from './events.js';

/**
 * Results that a later result made stale.
 *
 * A tool that reads something which changes — a page in a browser tab — can
 * name what it read in its result (`supersede.key`) and say whether the read is
 * whole or only what changed since the last one. Once a later result reads the
 * same key whole, every earlier result of that key says nothing the model still
 * needs, and is sent as a short marker instead (`recall` brings it back).
 *
 * In the Coolify task the first turn's page reads, one of them 178,073
 * characters, were sent again on each of the 44 calls of the second turn, long
 * after the agent had moved on to other pages. A partial read never stands in
 * for a whole one: what changed means something only against what it changed.
 *
 * Decided from the log alone, so projection and the context estimate agree, and
 * deterministic, so a prefix only changes when a new whole read arrives.
 */
export interface Supersede {
  /** What the result read, e.g. `browser:t1`. Results of different keys never touch. */
  readonly key: string;
  /** The whole of it, rather than only what changed since the last read. */
  readonly whole: boolean;
}

/** The `supersede` a tool output carries, if it carries a well-formed one. */
export function supersedeOf(output: unknown): Supersede | null {
  if (typeof output !== 'object' || output === null) return null;
  const s = (output as { supersede?: unknown }).supersede;
  if (typeof s !== 'object' || s === null) return null;
  const { key, whole } = s as { key?: unknown; whole?: unknown };
  return typeof key === 'string' && key !== '' && typeof whole === 'boolean' ? { key, whole } : null;
}

/** callIds of results a later whole result of the same key replaced. */
export function supersededCallIds(events: ReadonlyArray<MoxxyEvent>): ReadonlySet<string> {
  const superseded = new Set<string>();
  const readWholeLater = new Set<string>();
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e === undefined || e.type !== 'tool_result' || e.error) continue;
    const s = supersedeOf(e.output);
    if (!s) continue;
    if (readWholeLater.has(s.key)) superseded.add(e.callId);
    else if (s.whole) readWholeLater.add(s.key);
  }
  return superseded;
}

/** Deterministic marker for a superseded result. Stable bytes → cache-safe. */
export function supersededStub(callId: string, bytes: number): string {
  const label = bytes >= 1024 ? `${(Math.round(bytes / 102.4) / 10).toFixed(1)} KB` : `${bytes} B`;
  return `[superseded — a later result read the same thing whole · ${label} · recall("${callId}") to view]`;
}
