/**
 * Shared style tokens + helpers for the transcript block components.
 * Kept tiny and dependency-free so every block file (tool / subagent /
 * assistant) can pull the same expanded-body `<pre>` look.
 */

export const preStyle: React.CSSProperties = {
  margin: 0,
  padding: '8px 10px',
  background: 'var(--color-input-soft)',
  border: '1px solid var(--color-card-border)',
  borderRadius: 6,
  fontSize: 11,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  maxHeight: 280,
  overflow: 'auto',
};

/** Hard cap on the rendered tool-body string. A hostile/large tool result
 *  (multi-MB file dumps, base64, deeply-nested JSON) would otherwise be fully
 *  materialised into a DOM text node on every expand. We stringify, then clamp
 *  to this many characters with a suffix telling the user how much was dropped. */
const MAX_PRETTY_CHARS = 100_000;

function clamp(text: string): string {
  if (text.length <= MAX_PRETTY_CHARS) return text;
  const dropped = text.length - MAX_PRETTY_CHARS;
  return `${text.slice(0, MAX_PRETTY_CHARS)}\n… ${dropped.toLocaleString()} more chars truncated`;
}

/** Pretty 2-space JSON for the expanded tool body (distinct from
 *  chat-model's single-line `stringify`, which feeds summaries). Bounded so a
 *  huge tool payload can't blow up the DOM / retained allocation. */
export function pretty(value: unknown): string {
  if (typeof value === 'string') return clamp(value);
  try {
    // JSON.stringify of a very large/deeply-nested object can be slow or throw
    // RangeError; the catch falls back to String(value), which we also clamp.
    return clamp(JSON.stringify(value, null, 2) ?? String(value));
  } catch {
    return clamp(String(value));
  }
}
