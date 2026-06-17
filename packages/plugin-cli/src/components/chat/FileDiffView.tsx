import React from 'react';
import { Box, Text } from 'ink';
import {
  diffGutterNo,
  fileDiffSummary,
  fileDiffVerb,
  toDiffRows,
  type DiffRow,
  type FileDiffDisplay,
} from '@moxxy/sdk';
import { Colors, Glyphs } from '../../theme.js';

/** Lines shown before the diff is collapsed (Ctrl+O expands to the full set).
 *  Generous enough that a typical single-hunk edit shows in full. */
const COLLAPSED_ROWS = 16;

// Dark, low-saturation backgrounds so colored text stays readable in any
// terminal theme. Foreground carries the add/remove signal; no per-token
// syntax highlighting (a classic diff look).
const ADD_BG = '#0e2b18';
const DEL_BG = '#2e1216';

const DiffRowLine: React.FC<{ row: DiffRow; gutterWidth: number }> = ({ row, gutterWidth }) => {
  if (row.kind === 'gap') {
    return (
      <Box>
        <Text dimColor>{' '.repeat(gutterWidth)} ⋯</Text>
      </Box>
    );
  }
  const no = diffGutterNo(row);
  const gutter = (no === undefined ? '' : String(no)).padStart(gutterWidth);
  const marker = row.kind === 'add' ? '+' : row.kind === 'del' ? '-' : ' ';
  const body = `${marker} ${row.text}`;
  return (
    <Box>
      <Text dimColor>{gutter} </Text>
      {row.kind === 'add' ? (
        <Text backgroundColor={ADD_BG} color="green">{body}</Text>
      ) : row.kind === 'del' ? (
        <Text backgroundColor={DEL_BG} color="red">{body}</Text>
      ) : (
        <Text dimColor>{body}</Text>
      )}
    </Box>
  );
};

/**
 * Renders a settled Write/Edit result as a classic diff: a header
 * (`◆ Update(path)`), a one-line summary (`└ Added N lines, removed M`),
 * then the changed slices with a line-number gutter, +/- markers, and
 * green/red backgrounds. Collapsed to a preview by default; the global
 * Ctrl+O toggle expands every file diff to its full set of hunks.
 */
export const FileDiffView: React.FC<{
  display: FileDiffDisplay;
  /** Global Ctrl+O toggle. */
  expanded: boolean;
}> = ({ display, expanded }) => {
  const allRows = toDiffRows(display);
  const rows = expanded ? allRows : allRows.slice(0, COLLAPSED_ROWS);
  const hidden = allRows.length - rows.length;
  const gutterWidth = Math.max(
    2,
    ...rows.map((r) => (r.kind === 'gap' ? 0 : String(diffGutterNo(r) ?? '').length)),
  );
  const dotColor = display.mode === 'create' ? Colors.active : 'cyan';
  return (
    <Box flexDirection="column" marginTop={1}>
      <Box>
        <Text color={dotColor}>{Glyphs.filled} </Text>
        <Text bold>{fileDiffVerb(display)}</Text>
        <Text dimColor>{`(${display.path})`}</Text>
      </Box>
      <Box>
        <Text dimColor>{`  └ ${fileDiffSummary(display)}`}</Text>
      </Box>
      {display.hunks.length > 0 ? (
        <Box flexDirection="column" marginTop={0}>
          {rows.map((row, i) => (
            <DiffRowLine key={i} row={row} gutterWidth={gutterWidth} />
          ))}
          {hidden > 0 ? (
            <Box>
              <Text dimColor>{`${' '.repeat(gutterWidth)} … +${hidden} more lines (ctrl+o to expand)`}</Text>
            </Box>
          ) : null}
        </Box>
      ) : null}
    </Box>
  );
};
