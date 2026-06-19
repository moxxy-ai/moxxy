import type { PiiCategory, PiiCounts } from '@moxxy/anonymizer';
import { CATEGORY_LABELS } from './labels';

/** Per-category occurrence chips from a redaction report. */
export function Counts({ counts, total }: { counts: PiiCounts; total: number }): JSX.Element {
  const rows = (Object.keys(counts) as PiiCategory[]).filter((c) => counts[c] > 0);
  if (total === 0) {
    return (
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 7,
          alignSelf: 'flex-start',
          padding: '6px 12px',
          borderRadius: 999,
          fontSize: 12.5,
          color: 'var(--color-text-muted)',
          background: 'var(--color-input-soft)',
          border: '1px solid var(--color-card-border)',
        }}
      >
        Nothing detected yet.
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 12.5,
          fontWeight: 700,
          padding: '3px 10px',
          borderRadius: 999,
          color: '#fff',
          background: 'var(--color-primary-strong)',
        }}
      >
        {total} redacted
      </span>
      {rows.map((c) => (
        <span
          key={c}
          // The visual `·` separator reads as noise to a screen reader, so give
          // the chip a clean spoken label ("Emails: 3") and hide the glyph.
          aria-label={`${CATEGORY_LABELS[c]}: ${counts[c]}`}
          style={{
            fontSize: 12,
            padding: '3px 9px',
            borderRadius: 999,
            background: 'var(--color-surface)',
            border: '1px solid var(--color-card-border)',
            color: 'var(--color-text-muted)',
          }}
        >
          <span aria-hidden>
            {CATEGORY_LABELS[c]} · {counts[c]}
          </span>
        </span>
      ))}
    </div>
  );
}
