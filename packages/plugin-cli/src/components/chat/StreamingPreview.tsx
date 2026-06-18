import React, { memo } from 'react';
import { Box, Text } from 'ink';
import { Glyphs } from '../../theme.js';

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
export const StreamingPreview: React.FC<{ content: string; dim?: boolean }> = memo(
  function StreamingPreview({ content, dim }) {
  const cols = process.stdout.columns ?? 80;
  // Room for the marker column (glyph + 1-col margin) plus a little slack.
  const innerCols = Math.max(20, cols - 4);

  // Show the most recent non-empty line so the row reads as live typing.
  const shown = lastNonEmptyLineShown(content, innerCols);

  return (
    <Box flexDirection="row" marginTop={1}>
      <Box marginRight={1}>
        <Text dimColor>{Glyphs.filled}</Text>
      </Box>
      <Text dimColor={dim}>{shown || ' '}</Text>
    </Box>
  );
});

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
