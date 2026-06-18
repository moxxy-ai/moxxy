/**
 * Stable, key-order-canonical hash of a tool call's input, so `{a:1,b:2}` and
 * `{b:2,a:1}` produce the same key. Use for any "have I seen this call before"
 * comparison — a raw `JSON.stringify` is NOT order-stable.
 */
export function stableHash(input: unknown): string {
  return canonicalize(input);
}

function canonicalize(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalize).join(',') + ']';
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(
    ([a], [b]) => (a < b ? -1 : a > b ? 1 : 0),
  );
  return '{' + entries.map(([k, v]) => JSON.stringify(k) + ':' + canonicalize(v)).join(',') + '}';
}
