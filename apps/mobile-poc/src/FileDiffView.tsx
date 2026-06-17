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

export function FileDiffView({ display }: { display: FileDiffDisplay }): React.JSX.Element {
  const rows = toDiffRows(display);

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {fileDiffVerb(display)} · {display.path}
        </Text>
        <Text style={styles.headerCounts}>
          <Text style={styles.add}>+{display.added}</Text>{' '}
          <Text style={styles.del}>−{display.removed}</Text>
        </Text>
      </View>
      <Text style={styles.summary}>{fileDiffSummary(display)}</Text>

      {/* Horizontal scroll keeps long lines from wrapping/clipping. */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View>
          {rows.map((row, i) => (
            <DiffRowView key={i} row={row} />
          ))}
        </View>
      </ScrollView>
    </View>
  );
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

  return (
    <View style={[styles.row, rowStyle]}>
      <Text style={styles.gutter}>{no ?? ''}</Text>
      <Text style={[styles.marker, textStyle]}>{marker}</Text>
      <Text style={[styles.lineText, textStyle]}>{row.text}</Text>
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
  summary: { color: '#6f6f7c', fontSize: 11, paddingHorizontal: 12, paddingBottom: 8 },

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
