import React, { memo } from 'react';
import { Box, Text } from 'ink';
import { Markdown } from '../Markdown.js';
import { Colors, Glyphs } from '../../theme.js';
import { blockGap } from './density.js';

/**
 * The assistant reads like a document, not a chat bubble. A single brand
 * marker carries authorship while the Markdown owns the visual hierarchy.
 * Keeping the marker beside the first block also makes stream -> settled
 * transitions stable: both states begin with the same diamond.
 */
export const AssistantBlock: React.FC<{ content: string }> = memo(function AssistantBlock({
  content,
}) {
  if (!content.trim()) return null;
  return (
    <Box flexDirection="row" marginTop={blockGap()}>
      <Text color={Colors.busy}>{Glyphs.filled}</Text>
      <Box flexDirection="column" flexGrow={1} flexShrink={1} marginLeft={1}>
        <Markdown content={content} firstBlockTight />
      </Box>
    </Box>
  );
});
