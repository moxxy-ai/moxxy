import React from 'react';
import { Box, Text } from 'ink';
import { THEME } from '../../theme.js';

export function SystemMessage({ msg }) {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold color={THEME.dim}>System</Text>
      <Text color={THEME.dim}>{msg.content || ''}</Text>
    </Box>
  );
}
