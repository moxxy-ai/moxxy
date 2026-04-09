import React from 'react';
import { Box, Text } from 'ink';
import { THEME } from '../../theme.js';

export function SkillMessage({ msg, showDetails = false }) {
  const isRunning = msg.status === 'running';
  const isError = msg.status === 'error';
  const steps = msg.steps || [];

  // Header icon and color
  let headerIcon = '⊞';
  let headerColor = THEME.primary;
  if (msg.status === 'completed') {
    headerIcon = '✓';
    headerColor = THEME.success;
  } else if (isError) {
    headerIcon = '✗';
    headerColor = THEME.error;
  }

  // Header text
  const headerText = isRunning
    ? `Invoking ${msg.name}...`
    : msg.name;

  return (
    <Box flexDirection="column">
      <Text>
        <Text color={headerColor}>{headerIcon}</Text>
        <Text bold color={headerColor}> {headerText}</Text>
        {isError && msg.error ? <Text color={THEME.error}> - {msg.error}</Text> : null}
      </Text>
      {steps.map((step, i) => {
        let stepIcon = '◷';
        let stepColor = THEME.dim;
        if (step.status === 'completed') {
          stepIcon = '◷';
          stepColor = THEME.dim;
        } else if (step.status === 'error') {
          stepIcon = '✗';
          stepColor = THEME.error;
        } else {
          stepIcon = '⏳';
          stepColor = THEME.warning;
        }
        const resultText = step.error
          ? step.error
          : step.result
            ? (step.result.length > 60 ? step.result.slice(0, 60) + '…' : step.result)
            : null;
        return (
          <Text key={i}>
            <Text color={stepColor}>{stepIcon}</Text>
            <Text bold> {step.name}</Text>
            {resultText ? <Text color={THEME.dim}> → {resultText}</Text> : null}
          </Text>
        );
      })}
    </Box>
  );
}
