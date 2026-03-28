import React from 'react';
import { Box, Text } from 'ink';
import { THEME } from '../../theme.js';

export function EventMessage({ msg }) {
  const isError = msg.eventType?.includes('failed') || msg.eventType?.includes('violation') || msg.eventType?.includes('denied');
  const color = isError ? THEME.error : THEME.dim;

  if (msg.type === 'hive-event') {
    return (
      <Box marginTop={1}>
        <Text color={THEME.dim}>{msg.content || ''}</Text>
      </Box>
    );
  }

  return (
    <Box marginTop={1}>
      <Text color={color}>[{msg.eventType}] {JSON.stringify(msg.payload || {}).slice(0, 100)}</Text>
    </Box>
  );
}
