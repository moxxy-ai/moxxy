/**
 * Minimal unified-diff renderer. Takes the raw `git diff` text and colours each
 * line: additions green, deletions red, hunk headers dim, file headers bold. No
 * diff library — git already produced the unified text; we just style it.
 */

/** Cap the DOM nodes materialized for a single diff. The server already caps
 *  `git.diff`, but a near-cap diff (many thousands of lines) rendered as one
 *  styled <div> per line can still briefly freeze the rail. Beyond this we stop
 *  and show a truncation note rather than mount unbounded nodes. */
const MAX_DIFF_LINES = 4000;

export function DiffView({ diff }: { readonly diff: string }): JSX.Element {
  if (!diff.trim()) {
    return <Empty>No changes.</Empty>;
  }
  const allLines = diff.split('\n');
  const truncated = allLines.length > MAX_DIFF_LINES;
  const lines = truncated ? allLines.slice(0, MAX_DIFF_LINES) : allLines;
  return (
    <pre
      className="mono"
      style={{
        margin: 0,
        padding: 10,
        fontSize: 11.5,
        lineHeight: 1.5,
        overflow: 'auto',
        height: '100%',
        background: 'var(--color-input-soft)',
        borderRadius: 8,
        whiteSpace: 'pre',
      }}
    >
      {lines.map((line, i) => (
        <div key={i} style={lineStyle(line)}>
          {line || ' '}
        </div>
      ))}
      {truncated && (
        <div style={{ color: 'var(--color-text-dim)', padding: '8px 0' }}>
          … diff truncated ({allLines.length - MAX_DIFF_LINES} more lines)
        </div>
      )}
    </pre>
  );
}

function lineStyle(line: string): React.CSSProperties {
  if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff ')) {
    return { color: 'var(--color-text-muted)', fontWeight: 700 };
  }
  if (line.startsWith('@@')) return { color: '#7aa2f7' };
  if (line.startsWith('+')) return { color: '#9ece6a', background: 'rgba(158,206,106,0.08)' };
  if (line.startsWith('-')) return { color: '#f7768e', background: 'rgba(247,118,142,0.08)' };
  return { color: 'var(--color-text-muted)' };
}

function Empty({ children }: { readonly children: React.ReactNode }): JSX.Element {
  return (
    <div style={{ padding: 16, fontSize: 12, color: 'var(--color-text-dim)' }}>{children}</div>
  );
}
