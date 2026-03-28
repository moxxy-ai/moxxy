import React from 'react';
import { Box, Text } from 'ink';
import { THEME } from '../../theme.js';

export function ChannelMessage({ msg }) {
  const channel = msg.channel ? msg.channel.charAt(0).toUpperCase() + msg.channel.slice(1) : 'Channel';
  const sender = msg.sender || 'User';

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text>
        <Text bold color={THEME.user}>{sender}</Text>
        <Text color={THEME.dim}> via {channel}</Text>
      </Text>
      <Text wrap="wrap">{msg.content || ''}</Text>
    </Box>
  );
}
