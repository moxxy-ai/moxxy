/**
 * Minimal unified-diff renderer. Takes the raw `git diff` text and colours each
 * line: additions green, deletions red, hunk headers dim, file headers bold. No
 * diff library — git already produced the unified text; we just style it.
 */

export function DiffView({ diff }: { readonly diff: string }): JSX.Element {
  if (!diff.trim()) {
    return <Empty>No changes.</Empty>;
  }
  const lines = diff.split('\n');
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
