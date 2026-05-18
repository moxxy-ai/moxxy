import React from 'react';
import { Box, Text } from 'ink';
import { Glyphs } from '../theme.js';

export interface PhaseMarkerProps {
  /** Primary label (e.g. "Thought for 2.5s", "Edit path/to/file.ts"). */
  readonly label: string;
  /** Optional secondary text — dim, rendered after the label. */
  readonly detail?: string;
}

/**
 * Compact `◆ <label>` row used by `<ChatView>` and `<StatusLine>` to
 * mark assistant phases (thoughts, file edits, plan review). Always
 * lives at the chat's left margin, gets one row of top spacing.
 */
export const PhaseMarker: React.FC<PhaseMarkerProps> = ({ label, detail }) => {
  return (
    <Box marginTop={1}>
      <Text dimColor>{Glyphs.filled}</Text>
      <Text> </Text>
      <Text>{label}</Text>
      {detail ? <Text dimColor>{`  ${detail}`}</Text> : null}
    </Box>
  );
};
