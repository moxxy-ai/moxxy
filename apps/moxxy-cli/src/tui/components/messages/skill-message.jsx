import React from 'react';
import { Box, Text } from 'ink';
import { THEME } from '../../theme.js';

export function SkillMessage({ msg, showDetails = false }) {
  let icon = '⚡';
  let color = THEME.warning;

  if (msg.status === 'completed') {
    icon = '✓';
    color = THEME.success;
  } else if (msg.status === 'error') {
    icon = '✗';
    color = THEME.error;
  }

  return (
    <Box flexDirection="column">
      <Text>
        <Text color={color}>{icon}</Text>
        <Text bold color={color}> {msg.name}</Text>
        <Text color={THEME.dim}> skill</Text>
        {msg.status === 'running' && <Text color={THEME.dim}> …</Text>}
        {msg.error ? <Text color={THEME.error}> - {msg.error}</Text> : null}
      </Text>
      {showDetails && msg.description ? (
        <Text color={THEME.dim}>  {msg.description}</Text>
      ) : null}
    </Box>
  );
}
