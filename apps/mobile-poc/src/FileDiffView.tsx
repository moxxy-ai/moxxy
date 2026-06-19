/**
 * Renders a tool_result's `file-diff` display payload as a classic diff card:
 * a header (`<verb> · <path>` + "+X −Y") then the changed slices — a
 * line-number gutter, +/- markers, green/red line backgrounds, a `⋯` row for
 * the gaps between non-contiguous hunks. No token-level syntax highlighting,
 * just the diff backgrounds + colored +/- lines, matching the cross-channel
 * contract every other surface (CLI/Telegram/HTTP) renders.
 *
 * Everything structural comes from `@moxxy/sdk`'s pure helpers (`toDiffRows`,
 * `diffGutterNo`, `fileDiffSummary`, `fileDiffVerb`) — no node deps, safe in RN.
 */

import React from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  diffGutterNo,
  fileDiffSummary,
  fileDiffVerb,
  toDiffRows,
  type DiffRow,
  type FileDiffDisplay,
} from '@moxxy/sdk/tool-display';

const mono = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

/** Cap rendered diff rows on the client: the runner's `truncated` flag is
 *  advisory and a malformed/uncapped payload could otherwise mount thousands
 *  of native views at once. Excess rows collapse to a one-line notice. */
const MAX_ROWS = 400;

/** Coerce a possibly-malformed remote count to a safe non-negative integer. */
function safeCount(n: unknown): number {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

/** Build diff rows defensively: the `display` crosses a trust boundary and the
 *  SDK's `isFileDiffDisplay` only checks `kind` + `Array.isArray(hunks)`, not
 *  hunk/line shape. A hunk missing a `lines` array would make `toDiffRows`
 *  throw `undefined is not iterable` and (with no error boundary) blank the
 *  whole chat. Return an empty list on any shape error instead. */
function safeDiffRows(display: FileDiffDisplay): DiffRow[] {
  if (!Array.isArray(display.hunks)) return [];
  try {
    return toDiffRows(display);
  } catch {
    return [];
  }
}

export function FileDiffView({ display }: { display: FileDiffDisplay }): React.JSX.Element {
  const allRows = safeDiffRows(display);
  const rows = allRows.length > MAX_ROWS ? allRows.slice(0, MAX_ROWS) : allRows;
  const hiddenRows = allRows.length - rows.length;
  const path = String(display.path ?? '');
  const added = safeCount(display.added);
  const removed = safeCount(display.removed);
  // Feed the summary/verb helpers a sanitized payload so malformed counts
  // (NaN/undefined from the remote) can't render "Added NaN lines".
  const safeDisplay: FileDiffDisplay = { ...display, path, added, removed };

  return (
    <View
      style={styles.card}
      // Not a single a11y element: the header + per-row labels below let a
      // screen reader navigate the diff line-by-line instead of collapsing it
      // into one opaque announcement. (A label here would be ignored anyway.)
      accessible={false}
    >
      <View style={styles.header}>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {fileDiffVerb(safeDisplay)} · {path}
        </Text>
        <Text style={styles.headerCounts}>
          <Text style={styles.add}>+{added}</Text>{' '}
          <Text style={styles.del}>−{removed}</Text>
        </Text>
      </View>
      <Text style={styles.summary}>{fileDiffSummary(safeDisplay)}</Text>

      {/* Horizontal scroll keeps long lines from wrapping/clipping. */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View>
          {rows.map((row, i) => (
            <DiffRowView key={rowKey(row, i)} row={row} />
          ))}
        </View>
      </ScrollView>
      {hiddenRows > 0 ? (
        <Text style={styles.summary} accessibilityRole="text">
          …and {hiddenRows} more {hiddenRows === 1 ? 'line' : 'lines'} (diff capped)
        </Text>
      ) : null}
    </View>
  );
}

/** Stable-ish key: prefer the line's own number so reconciliation survives
 *  reorder; fall back to index for gap markers. */
function rowKey(row: DiffRow, i: number): string {
  if (row.kind === 'gap') return `gap-${i}`;
  const no = diffGutterNo(row);
  return no !== undefined ? `${row.kind}-${no}` : `${row.kind}-${i}`;
}

function DiffRowView({ row }: { row: DiffRow }): React.JSX.Element {
  if (row.kind === 'gap') {
    return (
      <View style={styles.gapRow}>
        <Text style={styles.gapText}>⋯</Text>
      </View>
    );
  }

  const rowStyle =
    row.kind === 'add' ? styles.addRow : row.kind === 'del' ? styles.delRow : styles.contextRow;
  const textStyle =
    row.kind === 'add' ? styles.addText : row.kind === 'del' ? styles.delText : styles.contextText;
  const marker = row.kind === 'add' ? '+' : row.kind === 'del' ? '−' : ' ';
  const no = diffGutterNo(row);
  // Announce the change kind so the red/green color is not the only signal.
  const kindWord = row.kind === 'add' ? 'added' : row.kind === 'del' ? 'removed' : 'unchanged';

  return (
    <View
      style={[styles.row, rowStyle]}
      accessible
      accessibilityRole="text"
      accessibilityLabel={`${kindWord} line${no !== undefined ? ` ${no}` : ''}: ${String(row.text ?? '')}`}
    >
      <Text style={styles.gutter}>{no ?? ''}</Text>
      <Text style={[styles.marker, textStyle]}>{marker}</Text>
      <Text style={[styles.lineText, textStyle]}>{String(row.text ?? '')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#15151b',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2a2a33',
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingTop: 10,
    gap: 8,
  },
  headerTitle: { color: '#f2f2f5', fontSize: 13, fontWeight: '600', flexShrink: 1 },
  headerCounts: { fontSize: 12, fontFamily: mono },
  // Raised from #6f6f7c to clear WCAG AA contrast on the #15151b card.
  summary: { color: '#9a9aa6', fontSize: 11, paddingHorizontal: 12, paddingBottom: 8 },

  row: { flexDirection: 'row', alignItems: 'flex-start', paddingRight: 12 },
  contextRow: { backgroundColor: 'transparent' },
  addRow: { backgroundColor: '#11261e' },
  delRow: { backgroundColor: '#3d1b22' },

  gutter: {
    width: 44,
    paddingHorizontal: 8,
    textAlign: 'right',
    color: '#5a5a66',
    fontFamily: mono,
    fontSize: 12,
    lineHeight: 18,
  },
  marker: {
    width: 14,
    textAlign: 'center',
    fontFamily: mono,
    fontSize: 12,
    lineHeight: 18,
  },
  lineText: { fontFamily: mono, fontSize: 12, lineHeight: 18 },

  add: { color: '#4ade80' },
  del: { color: '#f87171' },
  addText: { color: '#7ee2a8' },
  delText: { color: '#f4a3ad' },
  contextText: { color: '#9a9aa6' },

  gapRow: { paddingVertical: 2, paddingLeft: 44 },
  gapText: { color: '#5a5a66', fontFamily: mono, fontSize: 12, lineHeight: 18 },
});
