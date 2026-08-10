import React, { memo } from 'react';
import { Box, Text } from 'ink';
import { Markdown } from '../Markdown.js';
import { Colors } from '../../theme.js';
import { blockGap } from './density.js';

/**
 * Renders a settled assistant turn with the same restrained speaker/body
 * rhythm as user prompts. The label carries identity; the body remains
 * ordinary readable prose rather than another framed terminal card.
 */
export const AssistantBlock: React.FC<{ content: string }> = memo(function AssistantBlock({
  content,
}) {
  if (!content.trim()) return null;
  return (
    <Box flexDirection="column" marginTop={blockGap()} paddingX={1}>
      <Text color={Colors.busy} bold>MOXXY</Text>
      <Box flexDirection="column" flexGrow={1} marginLeft={1}>
        <Markdown content={content} firstBlockTight />
      </Box>
    </Box>
  );
});
