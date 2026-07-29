import { useState } from 'react';
import {
  diffGutterNo,
  fileDiffSummary,
  fileDiffVerb,
  toDiffRows,
  type DiffRow,
  type FileDiffDisplay,
} from '@moxxy/sdk/tool-display';
import { Icon } from '@moxxy/desktop-ui';

/** Rows shown before the diff is collapsed (click the header to expand). */
const COLLAPSED_ROWS = 14;

function rowStyle(kind: DiffRow['kind']): React.CSSProperties {
  // A wash, not a flood. The solid fills painted every changed row edge to edge
  // in saturated green, so a 260-line create became the loudest object in the
  // trace and the code inside it the least legible.
  if (kind === 'add') {
    return {
      background: 'color-mix(in srgb, var(--color-green) 12%, transparent)',
      color: 'var(--color-diff-add-text)',
    };
  }
  if (kind === 'del') {
    return {
      background: 'color-mix(in srgb, var(--color-red) 12%, transparent)',
      color: 'var(--color-diff-del-text)',
    };
  }
  return { color: 'var(--color-text-muted)' };
}

function DiffRowLine({ row, gutterWidth }: { row: DiffRow; gutterWidth: number }): JSX.Element {
  if (row.kind === 'gap') {
    return (
      <div style={{ display: 'flex', minWidth: 'max-content', color: 'var(--color-diff-gutter)' }}>
        <span style={{ width: gutterWidth, flexShrink: 0 }} />
        <span style={{ padding: '0 8px' }}>⋯</span>
      </div>
    );
  }
  const no = diffGutterNo(row);
  const marker = row.kind === 'add' ? '+' : row.kind === 'del' ? '-' : ' ';
  return (
    <div style={{ display: 'flex', minWidth: 'max-content', ...rowStyle(row.kind) }}>
      <span
        style={{
          width: gutterWidth,
          flexShrink: 0,
          textAlign: 'right',
          paddingRight: 8,
          color: 'var(--color-diff-gutter)',
          userSelect: 'none',
        }}
      >
        {no ?? ''}
      </span>
      <span style={{ width: 12, flexShrink: 0, textAlign: 'center', userSelect: 'none', opacity: 0.55 }}>{marker}</span>
      <span style={{ whiteSpace: 'pre', paddingRight: 12 }}>{row.text || ' '}</span>
    </div>
  );
}

/**
 * Renders a Write/Edit result as a diff card: a clickable header
 * ("Update · path" + a +X −Y badge) and the changed slices with a
 * line-number gutter, +/- markers, and green/red backgrounds. Collapsed to
 * a preview by default; clicking expands to the full set of hunks in a
 * scrollable container — "click to show the diff".
 */
export function FileDiffBlock({ display }: { readonly display: FileDiffDisplay }): JSX.Element {
  const [open, setOpen] = useState(false);
  const allRows = toDiffRows(display);
  const rows = open ? allRows : allRows.slice(0, COLLAPSED_ROWS);
  const hidden = allRows.length - rows.length;
  const gutterWidth =
    8 + Math.max(2, ...allRows.map((r) => (r.kind === 'gap' ? 0 : String(diffGutterNo(r) ?? '').length))) * 7;
  const verb = fileDiffVerb(display);

  return (
    <div
      data-testid="block-file-diff"
      style={{ minWidth: 0 }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0', width: '100%', textAlign: 'left' }}
        >
          <span style={{ fontWeight: 600, fontSize: 'var(--type-row)' }}>
            {verb}
            <span className="mono" style={{ color: 'var(--color-text-dim)', fontWeight: 500, marginLeft: 6 }}>
              · {display.path}
            </span>
          </span>
          <span style={{ fontSize: 'var(--type-label)', fontWeight: 600 }}>
            <span style={{ color: 'var(--color-diff-add-text)' }}>+{display.added}</span>{' '}
            <span style={{ color: 'var(--color-diff-del-text)' }}>−{display.removed}</span>
          </span>
          <span style={{ flex: 1 }} />
          {allRows.length > COLLAPSED_ROWS && (
            <span
              aria-hidden
              style={{
                color: 'var(--color-text-dim)',
                transform: open ? 'rotate(90deg)' : 'none',
                transition: 'transform 120ms ease',
                display: 'inline-flex',
              }}
            >
              <Icon name="chevron-right" size={14} />
            </span>
          )}
        </button>
        {display.hunks.length > 0 ? (
          <div
            className="mono"
            style={{
              marginTop: 'var(--space-6)',
              fontSize: 'var(--type-meta)',
              lineHeight: 1.55,
              border: '1px solid var(--color-card-border)',
              borderRadius: 'var(--radius-block)',
              background: 'var(--color-input-soft)',
              // A measure. Without one a long line stretched the diff to the
              // window edge, so the trace had no right margin and the code ran
              // under the workbench.
              maxWidth: '92ch',
              // The DIFF scrolls sideways, never the page.
              overflowX: 'auto',
              overflowY: 'auto',
              maxHeight: open ? 520 : 'none',
            }}
          >
            {rows.map((row, i) => (
              <DiffRowLine key={i} row={row} gutterWidth={gutterWidth} />
            ))}
            {hidden > 0 && (
              <button
                type="button"
                onClick={() => setOpen(true)}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '3px var(--space-8)',
                  fontSize: 'var(--type-label)',
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  color: 'var(--color-text-dim)',
                  background: 'var(--color-card-bg)',
                  borderTop: '1px solid var(--color-card-border)',
                  position: 'sticky',
                  left: 0,
                }}
              >
                … +{hidden} more lines
              </button>
            )}
          </div>
        ) : (
          <div style={{ marginTop: 4, fontSize: 11, color: 'var(--color-text-dim)' }}>{fileDiffSummary(display)}</div>
        )}
      </div>
    </div>
  );
}
