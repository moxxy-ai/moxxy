import React from 'react';
import { Box, Text } from 'ink';
import { THEME } from '../theme.js';

const MAX_VISIBLE_ROWS = 10;

function renderBrowseEntry(entry, isSelected) {
  if (entry.type === 'section') {
    return (
      <Text bold color="magenta">
        {entry.label}
      </Text>
    );
  }

  if (entry.type === 'custom') {
    const marker = entry.is_current ? '●' : '+';
    return (
      <Text
        backgroundColor={isSelected ? THEME.primary : undefined}
        color={isSelected ? 'black' : 'yellow'}
      >
        {` ${marker} Custom model…`}
        <Text color={isSelected ? 'black' : THEME.dim}>
          {entry.current_model_id ? `  current: ${entry.current_model_id}` : ''}
        </Text>
        <Text color={isSelected ? 'black' : THEME.dim}>
          {`  ${entry.provider_name}`}
        </Text>
      </Text>
    );
  }

  const marker = entry.is_current ? '●' : ' ';
  const badge = entry.deployment === 'local'
    ? '[Local] '
    : entry.deployment === 'cloud'
      ? '[Cloud] '
      : '';
  const badgeColor = isSelected
    ? 'black'
    : entry.deployment === 'cloud'
      ? 'blue'
      : entry.deployment === 'local'
        ? 'green'
        : THEME.dim;

  return (
    <Text
      backgroundColor={isSelected ? THEME.primary : undefined}
      color={isSelected ? 'black' : THEME.text}
    >
      {` ${marker} `}
      <Text color={badgeColor}>{badge}</Text>
      {entry.model_name}
      <Text color={isSelected ? 'black' : THEME.dim}>
        {`  ${entry.provider_name}`}
      </Text>
    </Text>
  );
}

export function ModelPicker({ picker, termHeight = 40 }) {
  if (!picker) return null;

  const visibleRows = Math.max(4, Math.min(MAX_VISIBLE_ROWS, termHeight - 18));

  if (picker.mode === 'custom') {
    return (
      <Box justifyContent="center" paddingX={2} marginBottom={1}>
        <Box
          width={72}
          flexDirection="column"
          borderStyle="round"
          borderColor={THEME.primary}
          paddingX={1}
          paddingY={1}
        >
          <Text bold color={THEME.primary}>Select model</Text>
          <Text color={THEME.dim}>
            Provider: <Text color={THEME.text}>{picker.providerName}</Text>
            <Text color={THEME.dim}>{` (${picker.providerId})`}</Text>
          </Text>
          <Text> </Text>
          <Text>
            <Text color={THEME.dim}>Model ID: </Text>
            <Text color={THEME.text}>{picker.value}</Text>
            <Text color={THEME.accent}>█</Text>
          </Text>
          <Text> </Text>
          <Text color={THEME.dim}>
            {picker.status || 'Enter confirms • Esc cancels'}
          </Text>
        </Box>
      </Box>
    );
  }

  const start = picker.scroll;
  const end = Math.min(picker.entries.length, start + visibleRows);
  const visibleEntries = picker.entries.slice(start, end);

  return (
    <Box justifyContent="center" paddingX={2} marginBottom={1}>
      <Box
        width={72}
        flexDirection="column"
        borderStyle="round"
        borderColor={THEME.primary}
        paddingX={1}
        paddingY={1}
      >
        <Text bold color={THEME.primary}>Select model</Text>
        <Text color={picker.focus === 'search' ? THEME.primary : THEME.dim}>
          Search: <Text color={THEME.text}>{picker.query}</Text>
          {picker.focus === 'search' && <Text color={THEME.accent}>█</Text>}
        </Text>
        <Text> </Text>
        {visibleEntries.length === 0 ? (
          <Text color={THEME.dim}>No models available.</Text>
        ) : (
          visibleEntries.map((entry, index) => {
            const absoluteIndex = start + index;
            return (
              <Box key={`${entry.type}:${entry.provider_id || entry.model_id || entry.label}:${absoluteIndex}`}>
                {renderBrowseEntry(entry, picker.selected === absoluteIndex)}
              </Box>
            );
          })
        )}
        <Text> </Text>
        <Text color={THEME.dim}>
          {picker.status || '↑↓ navigate • Tab switch • Enter select • Esc close'}
        </Text>
      </Box>
    </Box>
  );
}
