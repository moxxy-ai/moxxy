import React from 'react';
import { Box, Text } from 'ink';
import { Colors, Glyphs } from '../theme.js';
import type { QueuedMessage } from '../session/use-turn-runner.js';

/**
 * Compact list of pending messages rendered just above the input box.
 *
 *   ► next: triage the failed CI run
 *     · fetch latest stats
 *     · re-run the smoke tests
 *     ctrl+J send first next   ctrl+K drop first
 *
 * The `next:` row only appears when the user has force-sent something
 * (priority slot is set). Otherwise the list is the regular FIFO queue.
 * Long messages are truncated to one line; users can still review the
 * full text via `/queue`.
 */

const PREVIEW_MAX = 80;

function oneLinePreview(s: string): string {
  const flat = s.replace(/\s+/g, ' ').trim();
  return flat.length <= PREVIEW_MAX ? flat : flat.slice(0, PREVIEW_MAX) + '…';
}

export interface QueueViewProps {
  /** Live queue contents. Render-time read is safe because the caller
   *  bumps `queueCount` whenever the array mutates, which is what
   *  drives the re-render. */
  readonly messages: ReadonlyArray<QueuedMessage>;
  /** Priority slot set by `forceSendFirst`. Runs alone before the
   *  remaining queue drains. Null when no force-send is pending. */
  readonly priority: QueuedMessage | null;
}

export const QueueView: React.FC<QueueViewProps> = ({ messages, priority }) => {
  if (!priority && messages.length === 0) return null;

  return (
    <Box flexDirection="column" marginBottom={1}>
      {priority ? (
        <Box>
          <Text color={Colors.busy}>{Glyphs.contextUp} </Text>
          <Text bold>next: </Text>
          <Text>{oneLinePreview(priority.text)}</Text>
        </Box>
      ) : null}
      {messages.map((m, i) => (
        <Box key={i}>
          <Text dimColor>{`  · ${oneLinePreview(m.text)}`}</Text>
        </Box>
      ))}
      {messages.length > 0 ? (
        <Box marginTop={0}>
          <Text dimColor>{'  '}</Text>
          <Text dimColor>ctrl+j send first next   ctrl+k drop first   /clear-queue empty</Text>
        </Box>
      ) : null}
    </Box>
  );
};
