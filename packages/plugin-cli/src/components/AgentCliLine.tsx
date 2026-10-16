import React from 'react';
import { Box, Text } from 'ink';
import type { AgentCliNotice } from '@moxxy/chat-model';
import { Colors } from '../theme.js';

/** The command that fixes it, as the person would type it. */
export function agentCliLineHint(notice: AgentCliNotice): string {
  return `moxxy agents ${notice.action} ${notice.command}`;
}

/** Above the prompt while the active agent's CLI is missing, too old, or behind the vendor's latest. */
export const AgentCliLine: React.FC<{ readonly notice: AgentCliNotice }> = ({ notice }) => (
  <Box>
    <Text color={notice.severity === 'required' ? Colors.danger : Colors.busy}>●</Text>
    <Text>{` ${notice.text}`}</Text>
    <Text dimColor>{`  ·  ${agentCliLineHint(notice)}`}</Text>
  </Box>
);
