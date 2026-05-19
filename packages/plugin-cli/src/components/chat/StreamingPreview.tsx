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
 */
export const StreamingPreview: React.FC<{ content: string }> = memo(function StreamingPreview({
  content,
}) {
  const lines = content.split('\n');
  return (
    <Box flexDirection="row" marginTop={1}>
      <Box flexDirection="column" marginRight={1}>
        <Text dimColor>{Glyphs.filled}</Text>
      </Box>
      <Box flexDirection="column" flexGrow={1}>
        {lines.map((line, i) => (
          <Text key={i}>{line || ' '}</Text>
        ))}
      </Box>
    </Box>
  );
});

/**
 * Hard ceiling on the streaming preview, regardless of terminal
 * height. The previous "rows - 12" budget worked when the streaming
 * block was the ONLY thing in the live region, but a turn with open
 * skill scopes or pending tool calls above accumulates a tall live
 * region on top of the preview — push past terminal rows and Ink
 * drops into clear-on-each-frame overflow mode, which is the flicker
 * the user reports during long responses. Capping at 18 lines keeps
 * the preview compact enough that even a busy live region above
 * stays within a 30-row terminal without overflow.
 */
const STREAM_PREVIEW_MAX = 18;

/**
 * During streaming the AssistantBlock lives in the live render zone
 * (NOT in <Static>), so Ink redraws it on every chunk. When the body
 * grows taller than the terminal, Ink's renderer clips it — the top
 * scrolls off the visible area, never enters the terminal scrollback,
 * and you can't scroll up to recover it. Cap the visible portion to
 * roughly one viewport worth of lines so the live block always fits
 * and Ink never has to clip.
 *
 * Once the assistant_message lands, the FULL text becomes a settled
 * block and goes through <Static>, which writes it to scrollback in
 * one shot. So this cap only affects what's visible during the typing
 * animation — the historical record is complete.
 */
export function tailForViewport(content: string): string {
  const rows = process.stdout.rows ?? 24;
  const budget = Math.max(8, Math.min(STREAM_PREVIEW_MAX, rows - 14));
  const lines = content.split('\n');
  if (lines.length <= budget) return content;
  const elided = lines.length - budget;
  return `… (${elided} earlier line${elided === 1 ? '' : 's'} continuing — full text lands in scrollback when done)\n${lines
    .slice(-budget)
    .join('\n')}`;
}
