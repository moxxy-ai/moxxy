import React from 'react';
import { Box, Text } from 'ink';
import { THEME } from '../../theme.js';

export function UserMessage({ msg }) {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold color={THEME.user}>You</Text>
      <Text wrap="wrap">{msg.content || ''}</Text>
    </Box>
  );
}
