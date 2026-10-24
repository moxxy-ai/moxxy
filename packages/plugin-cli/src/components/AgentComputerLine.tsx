import React from 'react';
import { Box, Text } from 'ink';
import type { AgentComputerUse } from '@moxxy/sdk';
import { Colors } from '../theme.js';

/** What the line says while an agent uses the computer with its own tools. */
export function agentComputerText(use: AgentComputerUse, agentName: string | undefined): string {
  const agent = agentName ?? 'The agent';
  return `${agent} is using your computer${use.app ? ` · ${use.app}` : ''}`;
}

/** Above the prompt while the agent of an agent connection uses the person's computer; Esc stops its turn. */
export const AgentComputerLine: React.FC<{ readonly use: AgentComputerUse; readonly agentName: string | undefined }> = ({ use, agentName }) => (
  <Box>
    <Text color={Colors.busy}>●</Text>
    <Text>{` ${agentComputerText(use, agentName)}`}</Text>
    <Text dimColor>{'  ·  Esc stops it'}</Text>
  </Box>
);
