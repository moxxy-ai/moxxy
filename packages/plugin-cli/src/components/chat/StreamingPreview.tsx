import React, { memo } from 'react';
import { Box, Text } from 'ink';
import { Glyphs } from '../../theme.js';

/**
 * Plain-text rendering of the in-flight streaming buffer.
 *
 * Why not the full `<AssistantBlock>` / Markdown pipeline: the buffer
 * is INCOMPLETE markdown by definition — chunks arrive a few chars at
 * a time, so partial inline markers (`**Importan` waiting on the
 * closing `**`, half-typed `[link]` before the URL arrives, code-fence
 * openings before their close) trip the tokenizer. Depending on where
 * the chunk-cut falls, the parser either drops characters, leaves
 * literal `**` in place, or merges adjacent words across what would
 * become a list-item boundary. End result: garbled preview that
 * "fixes itself" only when the message completes.
 *
 * So: stream as plain text, keeping newlines / leading whitespace
 * intact so list structure is at least visible. The moment the
 * `assistant_message` event lands, the buffer flushes to '', the
 * message becomes a settled block, and the full Markdown render
 * kicks in inside `<Static>`. The user only sees plain text during
 * the ~ms-to-seconds typing animation, then the formatted version
 * for the rest of the session.
 *
 * Constant-height contract — DO NOT BREAK. The streaming preview is
 * rendered OUTSIDE `<Static>` (it changes every chunk), and Ink's
 * inline renderer commits live-region rows to scrollback whenever the
 * region grows by even one line. A naïve "render every line as a
 * <Text>" approach therefore stacks duplicate frames in scrollback as
 * the buffer fills (the bug surfaced empirically with long
 * deep-research synthesis writeups). We avoid this by emitting EXACTLY
 * `COMPACT_HEIGHT` rows every frame for long streams and a small
 * per-line capped block for short streams. As long as the rendered
 * height never grows, Ink updates in place instead of appending.
 */

/**
 * Threshold (in characters) above which we switch from the multi-line
 * preview to a single-line compact indicator. Below this the preview
 * is short enough that the height variance can't trip Ink's
 * scrollback-commit behavior. Above this we'd be streaming a long
 * response (synthesis writeup, large refactor explanation, etc.) and
 * the preview would otherwise grow tall enough to spam scrollback.
 */
const COMPACT_THRESHOLD_CHARS = 280;

/**
 * Number of logical lines reserved for the short-stream preview. Each
 * line is truncated to one terminal column width below, so the visual
 * height equals the logical line count — important so Ink doesn't
 * reflow as content shifts.
 */
const SHORT_PREVIEW_LINES = 4;

export const StreamingPreview: React.FC<{ content: string }> = memo(function StreamingPreview({
  content,
}) {
  if (content.length >= COMPACT_THRESHOLD_CHARS) {
    return <CompactIndicator content={content} />;
  }
  return <ShortPreview content={content} />;
});

/**
 * Long-response indicator: one constant-height row. Shows the typing
 * progress (chars + line count) without exposing the buffer body, so
 * Ink has nothing to grow and never commits intermediate frames to
 * scrollback. The full message lands settled via <Static> the moment
 * the assistant_message event arrives.
 */
const CompactIndicator: React.FC<{ content: string }> = ({ content }) => {
  const lineCount = content.split('\n').length;
  return (
    <Box marginTop={1}>
      <Text dimColor>{Glyphs.filled} streaming · {content.length} chars · {lineCount} line{lineCount === 1 ? '' : 's'} — full text lands in scrollback when done</Text>
    </Box>
  );
};

/**
 * Short-response preview: at most SHORT_PREVIEW_LINES rows of the
 * most recent buffer content, padded to exactly that height and with
 * each line truncated to terminal width so no line wraps. Constant
 * height means Ink updates in place between chunks.
 */
const ShortPreview: React.FC<{ content: string }> = ({ content }) => {
  const cols = process.stdout.columns ?? 80;
  // Leave room for the diamond glyph + 1-col margin in the row.
  const innerCols = Math.max(20, cols - 4);
  const lines = content.split('\n');
  const tail = lines.slice(-SHORT_PREVIEW_LINES);
  while (tail.length < SHORT_PREVIEW_LINES) tail.unshift('');
  const truncated = tail.map((line) =>
    line.length > innerCols ? line.slice(0, innerCols - 1) + '…' : line,
  );
  return (
    <Box flexDirection="row" marginTop={1}>
      <Box flexDirection="column" marginRight={1}>
        <Text dimColor>{Glyphs.filled}</Text>
        {Array.from({ length: SHORT_PREVIEW_LINES - 1 }, (_, i) => (
          <Text key={i}> </Text>
        ))}
      </Box>
      <Box flexDirection="column" flexGrow={1}>
        {truncated.map((line, i) => (
          <Text key={i}>{line || ' '}</Text>
        ))}
      </Box>
    </Box>
  );
};

/**
 * Pre-render no-op: the StreamingPreview component now handles its own
 * truncation, so tailForViewport doesn't need to trim anymore. Kept as
 * an identity passthrough so the call site in ChatView (and any other
 * callers / tests) stay unchanged.
 *
 * The old logical-line truncation was the source of the "stacked
 * placeholder rows in scrollback" symptom — each throttled chunk
 * produced a slightly different truncated string, which grew the
 * <Text> child count on every render, and Ink appended new rows
 * instead of overwriting them. By keeping the preview itself at a
 * constant rendered height we avoid the growth, and pre-trimming the
 * content is unnecessary.
 */
export function tailForViewport(content: string): string {
  return content;
}
