import React, { memo } from 'react';
import { Box, Text } from 'ink';
import { Colors } from '../../theme.js';
import { Spinner } from '../Spinner.js';
import { blockGap } from './density.js';

/**
 * In-flight streaming indicator: a SINGLE constant-height row showing the tail
 * of the line currently being typed, prefixed with the same `◆` marker the
 * settled assistant block uses.
 *
 * Two properties this design buys us, both load-bearing — DO NOT regress:
 *
 *  1. No height jump. The previous version reserved a 4-row block (padded with
 *     blanks), so the live region ballooned to ~5 rows while streaming and then
 *     collapsed to the assistant block's ~2 rows on settle — the visible
 *     "indicator → blank line jump → response snaps back up" the user reported.
 *     A single row (matching the assistant block's first line + shared
 *     `marginTop`) means the live region barely changes height across the
 *     stream→settle transition.
 *
 *  2. No scrollback stacking. The preview renders OUTSIDE `<Static>` and Ink
 *     commits live-region rows to scrollback whenever the region GROWS by a
 *     line. A constant single row never grows, so Ink updates it in place
 *     instead of appending duplicate frames (the old long-stream bug).
 *
 * It deliberately renders RAW text (not markdown): the buffer is incomplete
 * markdown by definition (chunks cut mid-`**`, mid-`[link]`, mid-fence), so the
 * full Markdown pipeline only kicks in once the `assistant_message` event lands
 * and the message becomes a settled `<Static>` block.
 */
export const StreamingPreview: React.FC<{
  content: string;
  kind: 'thinking' | 'writing';
}> = memo(
  function StreamingPreview({ content, kind }) {
  const cols = process.stdout.columns ?? 80;
  // Room for the speaker + activity label while preserving one visual row.
  const innerCols = Math.max(12, cols - 24);

  // Show the most recent non-empty line so the row reads as live typing.
  const shown = cleanStreamingTail(lastNonEmptyLineShown(content, innerCols));
  const label = kind === 'thinking' ? 'Thinking' : 'Writing';

  return (
    <Box flexDirection="row" marginTop={blockGap()} paddingX={1}>
      <Text color={Colors.busy} bold>MOXXY</Text>
      <Text>  </Text>
      <Spinner color={Colors.busy} />
      <Text dimColor>{` ${label}`}</Text>
      {shown ? <Text dimColor>{` · ${shown}`}</Text> : null}
    </Box>
  );
});

/** Strip incomplete Markdown chrome from the one-line live preview. */
export function cleanStreamingTail(line: string): string {
  return line
    .replace(/^\s{0,3}#{1,6}\s+/, '')
    .replace(/^\s*[-*+]\s+/, '')
    .trim();
}

/**
 * Pick the most recent non-empty line and render its tail exactly as the old
 * `content.split('\n')` scan did — but WITHOUT allocating an array of every line
 * in the (growing) buffer on each streamed chunk.
 *
 * Output-identical to the prior code for ALL inputs:
 *  - We walk lines from the end via `lastIndexOf('\n')` and stop at the first
 *    one whose `.trim()` is truthy — same "last non-empty line" the split-scan
 *    found. If every line is blank we fall back to the very last line (same as
 *    the old `if (!line) line = lines.at(-1)` branch).
 *  - The ellipsis/slice math is byte-for-byte the same: a line longer than
 *    `innerCols` becomes `'…' + line.slice(line.length - (innerCols - 1))`.
 *
 * Bounded work per chunk: only the trailing blank region plus the chosen line
 * are materialised, instead of the whole buffer — O(n^2) over a stream → O(n)
 * (≈ O(1) per chunk in the common "last line keeps growing" case).
 */
export function lastNonEmptyLineShown(content: string, innerCols: number): string {
  let end = content.length; // exclusive end of the current candidate line
  let chosenStart = -1;
  let chosenEnd = -1;
  // Walk backwards over `\n`-delimited lines. `start` is the index just after
  // the preceding newline (or 0 for the first line). Bounded by `end > 0`:
  // once `end` reaches 0 every line is consumed. (Without this, content with a
  // LEADING newline loops forever — `lastIndexOf('\n', -1)` clamps fromIndex to
  // 0 and finds the newline at index 0, so `start` becomes 1 and `end` is reset
  // to 0 every iteration, and the `start === 0` guard never fires.)
  while (end > 0) {
    const nl = content.lastIndexOf('\n', end - 1);
    const start = nl + 1; // 0 when no earlier newline
    if (content.slice(start, end).trim()) {
      chosenStart = start;
      chosenEnd = end;
      break;
    }
    if (start === 0) break; // exhausted all lines, none non-empty
    end = nl; // continue with the line before this newline
  }

  let line: string;
  if (chosenStart >= 0) {
    line = content.slice(chosenStart, chosenEnd);
  } else {
    // No non-empty line — mirror the old fallback to the LAST line (the text
    // after the final newline, or the whole string when there's no newline).
    const lastNl = content.lastIndexOf('\n');
    line = lastNl < 0 ? content : content.slice(lastNl + 1);
  }

  // Keep the END visible (leading ellipsis) so a long line scrolls left as it
  // grows rather than spilling onto a second row.
  return line.length > innerCols
    ? `…${line.slice(line.length - (innerCols - 1))}`
    : line;
}

/**
 * Identity passthrough kept for call-site / test stability — truncation now
 * lives entirely in the renderer above.
 */
export function tailForViewport(content: string): string {
  return content;
}
