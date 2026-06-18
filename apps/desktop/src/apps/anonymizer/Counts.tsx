import type { PiiCategory, PiiCounts } from '@moxxy/anonymizer';
import { CATEGORY_LABELS } from './labels';

/** Per-category occurrence chips from a redaction report. */
export function Counts({ counts, total }: { counts: PiiCounts; total: number }): JSX.Element {
  const rows = (Object.keys(counts) as PiiCategory[]).filter((c) => counts[c] > 0);
  if (total === 0) {
    return <span style={{ fontSize: 13, color: 'var(--color-text-dim)' }}>Nothing detected.</span>;
  }
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
      <span style={{ fontSize: 13, fontWeight: 600 }}>{total} redacted:</span>
      {rows.map((c) => (
        <span
          key={c}
          style={{
            fontSize: 12,
            padding: '2px 8px',
            borderRadius: 999,
            background: 'var(--color-bg-card)',
            border: '1px solid var(--color-border)',
            color: 'var(--color-text-muted)',
          }}
        >
          {CATEGORY_LABELS[c]} · {counts[c]}
        </span>
      ))}
    </div>
  );
}
