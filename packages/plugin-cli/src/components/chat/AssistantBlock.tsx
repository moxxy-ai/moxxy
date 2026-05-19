import React, { memo } from 'react';
import { Box, Text } from 'ink';
import { Markdown } from '../Markdown.js';
import { Glyphs } from '../../theme.js';

/**
 * Renders an assistant turn: a white `●` bullet on the first line and
 * the body rendered through the lightweight Markdown component
 * (headings, lists, code blocks, inline emphasis + links). Indented one
 * column past the bullet so the body reads as one visual unit attached
 * to its marker. Mirrors the Claude Code convention (white = assistant).
 */
export const AssistantBlock: React.FC<{ content: string }> = memo(function AssistantBlock({
  content,
}) {
  if (!content.trim()) return null;
  return (
    <Box flexDirection="row" marginTop={1}>
      <Box flexDirection="column" marginRight={1}>
        <Text dimColor>{Glyphs.filled}</Text>
      </Box>
      <Box flexDirection="column" flexGrow={1}>
        <Markdown content={content} firstBlockTight />
      </Box>
    </Box>
  );
});
