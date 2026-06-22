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
import { usePanelControls } from '../../shell/surfaces/panelControls';

/** Rows shown before the diff is collapsed (click the header to expand). */
const COLLAPSED_ROWS = 14;

function rowStyle(kind: DiffRow['kind']): React.CSSProperties {
  if (kind === 'add') return { background: 'var(--color-diff-add-bg)', color: 'var(--color-diff-add-text)' };
  if (kind === 'del') return { background: 'var(--color-diff-del-bg)', color: 'var(--color-diff-del-text)' };
  return { color: 'var(--color-text-muted)' };
}

function DiffRowLine({ row, gutterWidth }: { row: DiffRow; gutterWidth: number }): JSX.Element {
  if (row.kind === 'gap') {
    return (
      <div style={{ display: 'flex', color: 'var(--color-diff-gutter)' }}>
        <span style={{ width: gutterWidth, flexShrink: 0 }} />
        <span style={{ padding: '0 8px' }}>⋯</span>
      </div>
    );
  }
  const no = diffGutterNo(row);
  const marker = row.kind === 'add' ? '+' : row.kind === 'del' ? '-' : ' ';
  return (
    <div style={{ display: 'flex', ...rowStyle(row.kind) }}>
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
      <span style={{ width: 12, flexShrink: 0, textAlign: 'center', userSelect: 'none', opacity: 0.8 }}>{marker}</span>
      <span style={{ whiteSpace: 'pre', flex: 1 }}>{row.text || ' '}</span>
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
  const panel = usePanelControls();
  // Clicking the card's icon/title opens the file in the embedded pane (z.ai:
  // click the artifact chip → open the panel). Create → content, edit → diff.
  const openInPanel = (): void =>
    panel.openFile(display.path, display.mode === 'create' ? 'content' : 'diff');
  const allRows = toDiffRows(display);
  const rows = open ? allRows : allRows.slice(0, COLLAPSED_ROWS);
  const hidden = allRows.length - rows.length;
  const gutterWidth =
    8 + Math.max(2, ...allRows.map((r) => (r.kind === 'gap' ? 0 : String(diffGutterNo(r) ?? '').length))) * 7;
  const verb = fileDiffVerb(display);

  return (
    <div
      data-testid="block-file-diff"
      style={{ alignSelf: 'stretch', display: 'flex', gap: 12, maxWidth: '92%' }}
    >
      <button
        type="button"
        onClick={openInPanel}
        aria-label={`Open ${display.path} in the panel`}
        title="Open in panel"
        style={{
          width: 34,
          height: 34,
          flexShrink: 0,
          borderRadius: 10,
          background: display.mode === 'create' ? 'var(--color-green-soft)' : 'var(--color-primary-soft)',
          color: display.mode === 'create' ? 'var(--color-green)' : 'var(--color-primary)',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
        }}
      >
        <Icon name="edit" size={17} />
      </button>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0' }}>
          {/* Click the title to OPEN the artifact in the panel (z.ai). */}
          <button
            type="button"
            onClick={openInPanel}
            title="Open in panel"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              minWidth: 0,
              textAlign: 'left',
              cursor: 'pointer',
            }}
          >
            <span style={{ fontWeight: 600, fontSize: 13.5 }}>
              {verb}
              <span className="mono" style={{ color: 'var(--color-text-dim)', fontWeight: 500, marginLeft: 6 }}>
                · {display.path}
              </span>
            </span>
            <span className="mono" style={{ fontSize: 11, fontWeight: 600 }}>
              <span style={{ color: 'var(--color-green)' }}>+{display.added}</span>{' '}
              <span style={{ color: 'var(--color-red)' }}>−{display.removed}</span>
            </span>
          </button>
          <span style={{ flex: 1 }} />
          <button
            type="button"
            className="btn-icon"
            onClick={openInPanel}
            aria-label="Open in panel"
            title="Open in panel"
            style={{ width: 26, height: 26, borderRadius: 7, color: 'var(--color-text-dim)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <Icon name="external" size={14} />
          </button>
          {allRows.length > COLLAPSED_ROWS && (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              aria-label={open ? 'Collapse diff' : 'Expand diff'}
              title={open ? 'Collapse diff' : 'Expand diff'}
              style={{
                color: 'var(--color-text-dim)',
                display: 'inline-flex',
                transform: open ? 'rotate(90deg)' : 'none',
                transition: 'transform 120ms ease',
              }}
            >
              <Icon name="chevron-right" size={14} />
            </button>
          )}
        </div>
        {display.hunks.length > 0 ? (
          <div
            className="mono"
            style={{
              marginTop: 6,
              fontSize: 11.5,
              lineHeight: 1.5,
              border: '1px solid var(--color-card-border)',
              borderRadius: 6,
              overflow: 'auto',
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
                  padding: '4px 10px',
                  fontSize: 11,
                  color: 'var(--color-text-dim)',
                  background: 'var(--color-input-soft)',
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
