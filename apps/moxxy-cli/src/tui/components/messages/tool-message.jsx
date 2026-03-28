import React from 'react';
import { Box, Text } from 'ink';
import { THEME } from '../../theme.js';

const RESULT_MAX = 500;

function formatRaw(value) {
  if (value == null) return null;
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}

function truncateResult(text) {
  if (!text || text.length <= RESULT_MAX) return text;
  return text.slice(0, RESULT_MAX) + '\n… (truncated)';
}

export function ToolMessage({ msg, showDetails = false }) {
  let icon = '⚙';
  let color = THEME.tool;

  if (msg.status === 'completed') {
    icon = '✓';
    color = THEME.success;
  } else if (msg.status === 'error') {
    icon = '✗';
    color = THEME.error;
  }

  const rawArgs = showDetails ? formatRaw(msg.rawArguments) : null;
  const rawResult = showDetails ? truncateResult(formatRaw(msg.rawResult)) : null;

  return (
    <Box flexDirection="column">
      <Text>
        <Text color={color}>{icon}</Text>
        <Text bold color={color}> {msg.name}</Text>
        {msg.error ? <Text color={THEME.error}> - {msg.error}</Text> : null}
      </Text>
      {rawArgs && (
        <Box flexDirection="column" marginLeft={2} marginTop={0}>
          <Text bold color={THEME.dim}>input</Text>
          <Box marginLeft={2}>
            <Text color={THEME.dim} wrap="wrap">{rawArgs}</Text>
          </Box>
        </Box>
      )}
      {rawResult && (
        <Box flexDirection="column" marginLeft={2} marginTop={0}>
          <Text bold color={THEME.dim}>output</Text>
          <Box marginLeft={2}>
            <Text color={THEME.dim} wrap="wrap">{rawResult}</Text>
          </Box>
        </Box>
      )}
      {showDetails && msg.error && (
        <Box flexDirection="column" marginLeft={2} marginTop={0}>
          <Text bold color={THEME.error}>error</Text>
          <Box marginLeft={2}>
            <Text color={THEME.error} wrap="wrap">{msg.error}</Text>
          </Box>
        </Box>
      )}
    </Box>
  );
}
