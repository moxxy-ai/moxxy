import React from 'react';
import { Box, Text } from 'ink';
import { THEME } from '../../theme.js';

export function AskMessage({ msg }) {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold color={THEME.warning}>Agent needs input</Text>
      <Text color={THEME.text}>{msg.question || ''}</Text>
      <Text color={THEME.dim}>Type your answer below and press Enter.</Text>
    </Box>
  );
}
