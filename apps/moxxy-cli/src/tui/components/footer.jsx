import React from 'react';
import { Box, Text } from 'ink';
import { THEME } from '../theme.js';

export function Footer() {
  return (
    <Box width="100%" paddingX={1}>
      <Text color={THEME.dim}>
        {'  ^X stop  /help commands  ^C exit'}
      </Text>
    </Box>
  );
}
