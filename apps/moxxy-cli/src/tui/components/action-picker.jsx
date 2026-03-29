import React from 'react';
import { Box, Text } from 'ink';
import { THEME } from '../theme.js';

const MAX_VISIBLE_ROWS = 8;

export function ActionPicker({ picker, termHeight = 40 }) {
  if (!picker) return null;

  const visibleRows = Math.max(4, Math.min(MAX_VISIBLE_ROWS, termHeight - 18));
  const start = picker.scroll;
  const end = Math.min(picker.items.length, start + visibleRows);
  const visibleItems = picker.items.slice(start, end);

  return (
    <Box justifyContent="center" paddingX={2} marginBottom={1}>
      <Box
        width={64}
        flexDirection="column"
        borderStyle="round"
        borderColor={THEME.primary}
        paddingX={1}
        paddingY={1}
      >
        <Text bold color={THEME.primary}>{picker.title}</Text>
        <Text> </Text>
        {visibleItems.map((item, index) => {
          const absoluteIndex = start + index;
          const isSelected = absoluteIndex === picker.selected;
          return (
            <Box key={`${item.label}:${absoluteIndex}`}>
              <Text
                backgroundColor={isSelected ? THEME.primary : undefined}
                color={isSelected ? 'black' : THEME.text}
              >
                {` ${item.label}`}
                <Text color={isSelected ? 'black' : THEME.dim}>
                  {item.description ? `  ${item.description}` : ''}
                </Text>
              </Text>
            </Box>
          );
        })}
        <Text> </Text>
        <Text color={THEME.dim}>
          {picker.status || '↑↓ navigate • Enter select • Esc close'}
        </Text>
      </Box>
    </Box>
  );
}
