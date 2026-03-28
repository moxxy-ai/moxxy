import React from 'react';
import { Box, Text } from 'ink';
import { THEME } from '../../theme.js';
import { ToolMessage } from './tool-message.jsx';
import { SkillMessage } from './skill-message.jsx';

export function ToolGroup({ messages, expanded = false }) {
  const completed = messages.filter(m => m.status === 'completed').length;
  const errors = messages.filter(m => m.status === 'error').length;
  const running = messages.filter(m => m.status === 'invoked' || m.status === 'running').length;
  const allDone = running === 0;

  // While running, show all tools individually
  if (!allDone) {
    return (
      <Box flexDirection="column" marginTop={1}>
        {messages.map((msg, i) => {
          if (msg.type === 'skill') return <SkillMessage key={i} msg={msg} />;
          return <ToolMessage key={i} msg={msg} />;
        })}
      </Box>
    );
  }

  const icon = errors > 0 ? '✗' : '✓';
  const color = errors > 0 ? THEME.error : THEME.success;
  const skills = messages.filter(m => m.type === 'skill').length;
  const tools = messages.filter(m => m.type === 'tool').length;
  const parts = [];
  if (tools > 0) parts.push(`${tools} tool${tools > 1 ? 's' : ''}`);
  if (skills > 0) parts.push(`${skills} skill${skills > 1 ? 's' : ''}`);
  const label = parts.join(', ');
  const detail = errors > 0 ? `${completed} done, ${errors} failed` : `${completed} done`;

  if (!expanded) {
    return (
      <Box marginTop={1}>
        <Text>
          <Text color={color}>{icon}</Text>
          <Text color={THEME.dim}> {label} ({detail})</Text>
        </Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box>
        <Text>
          <Text color={color}>{icon}</Text>
          <Text color={THEME.dim}> {label} ({detail})</Text>
        </Text>
      </Box>
      <Box flexDirection="column" marginLeft={2}>
        {messages.map((msg, i) => {
          if (msg.type === 'skill') return <SkillMessage key={i} msg={msg} showDetails={true} />;
          return <ToolMessage key={i} msg={msg} showDetails={true} />;
        })}
      </Box>
    </Box>
  );
}
