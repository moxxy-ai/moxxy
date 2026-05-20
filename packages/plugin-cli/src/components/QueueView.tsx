import React from 'react';
import { Box, Text } from 'ink';
import { Glyphs } from '../theme.js';
import type { QueuedMessage } from '../session/use-turn-runner.js';

/**
 * Single dim line rendered directly above the input box. A thin top
 * rule separates it from the chat above so the strip reads as input
 * chrome rather than message content.
 *
 *   ──────────────────────────────────────────────────────────────────
 *   ▲ next: triage the failed CI run · +2 more · ⌃t send · ⌃b drop
 *
 * Users can review the full backlog via the `/queue` slash command.
 */

const PREVIEW_MAX = 60;

function oneLinePreview(s: string): string {
  const flat = s.replace(/\s+/g, ' ').trim();
  return flat.length <= PREVIEW_MAX ? flat : flat.slice(0, PREVIEW_MAX) + '…';
}

export interface QueueViewProps {
  readonly messages: ReadonlyArray<QueuedMessage>;
  readonly priority: QueuedMessage | null;
}

export const QueueView: React.FC<QueueViewProps> = ({ messages, priority }) => {
  if (!priority && messages.length === 0) return null;

  let headLabel: string;
  let headText: string;
  let restCount: number;
  if (priority) {
    headLabel = 'next';
    headText = priority.text;
    restCount = messages.length;
  } else {
    headLabel = 'queued';
    headText = messages[0]!.text;
    restCount = messages.length - 1;
  }

  const restPart = restCount > 0 ? ` · +${restCount} more` : '';

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderBottom={false}
      borderLeft={false}
      borderRight={false}
      borderColor="blackBright"
      borderDimColor
    >
      <Box>
        <Text color="blackBright" dimColor>{Glyphs.contextUp} </Text>
        <Text dimColor>
          {headLabel}: {oneLinePreview(headText)}{restPart} · ⌃t send · ⌃b drop
        </Text>
      </Box>
    </Box>
  );
};
