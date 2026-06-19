/**
 * Stable, key-order-canonical hash of a tool call's input, so `{a:1,b:2}` and
 * `{b:2,a:1}` produce the same key. Use for any "have I seen this call before"
 * comparison — a raw `JSON.stringify` is NOT order-stable.
 *
 * MUST be total: the input is a tool call's `input`, typed `unknown` and coming
 * straight from whatever the provider deserialized (it can carry a BigInt, a
 * circular reference, or a deeply nested structure). This hashes in the HOT
 * tool-dispatch path (`detector.record` in tool-dispatch.ts), where an
 * unhandled throw or a stack-overflow from unbounded recursion would crash the
 * whole turn. So every leaf is serialized defensively, cycles are detected and
 * collapsed to a stable marker, and recursion is depth-bounded.
 */
export function stableHash(input: unknown): string {
  try {
    return canonicalize(input, new WeakSet(), 0);
  } catch {
    // Last-ditch guard: an exotic value (e.g. a Proxy whose ownKeys/get trap
    // throws, or a getter that throws) could still surface a throw out of the
    // recursive walk. Never let it escape into the hot tool-dispatch path —
    // collapse to a stable opaque marker. Two such inputs hash equal, which at
    // worst makes the stuck detector slightly more eager, never crashes.
    return '"[unhashable]"';
  }
}

// Bound recursion so a hostile/pathologically-nested input can't blow the stack
// (the JS engine throws RangeError well before this, and a tool input that deep
// is already degenerate for stuck-detection purposes — treat it as opaque).
const MAX_DEPTH = 100;

/** Serialize a primitive leaf without ever throwing (BigInt/symbol/etc.). */
function leaf(value: unknown): string {
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'number':
      // JSON.stringify(NaN|±Infinity) is 'null'; keep that, but use a stable
      // distinct token so two different non-finite values don't collide.
      return Number.isFinite(value) ? String(value) : `#${String(value)}`;
    case 'boolean':
      return value ? 'true' : 'false';
    case 'bigint':
      // JSON.stringify THROWS on a BigInt — serialize it ourselves, tagged so a
      // bigint and the equal-valued number never collide.
      return `${value.toString()}n`;
    case 'symbol':
      return `@${String(value)}`;
    case 'function':
      return '"[fn]"';
    default:
      return 'null';
  }
}

function canonicalize(value: unknown, seen: WeakSet<object>, depth: number): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value !== 'object') return leaf(value);
  // Cycle guard: a circular reference would recurse forever → stack overflow.
  if (seen.has(value)) return '"[circular]"';
  if (depth >= MAX_DEPTH) return '"[deep]"';
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return '[' + value.map((v) => canonicalize(v, seen, depth + 1)).join(',') + ']';
    }
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    return (
      '{' +
      entries.map(([k, v]) => JSON.stringify(k) + ':' + canonicalize(v, seen, depth + 1)).join(',') +
      '}'
    );
  } finally {
    // Allow the same object to appear in sibling positions (DAG, not a cycle)
    // without being flagged circular — only ancestors are forbidden.
    seen.delete(value);
  }
}
