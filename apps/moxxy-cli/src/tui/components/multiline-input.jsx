import React, { useState, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import { THEME } from '../theme.js';

export function MultilineInput({ onSubmit, placeholder, prompt }) {
  const [value, setValue] = useState('');
  const [cursorCol, setCursorCol] = useState(0);

  useInput((input, key) => {
    // Enter without shift → submit
    if (key.return && !key.shift) {
      if (value.trim()) {
        onSubmit(value);
        setValue('');
        setCursorCol(0);
      }
      return;
    }

    // Shift+Enter → newline
    if (key.return && key.shift) {
      setValue(prev => prev + '\n');
      setCursorCol(0);
      return;
    }

    // Backspace
    if (key.backspace || key.delete) {
      if (value.length > 0) {
        setValue(prev => prev.slice(0, -1));
        setCursorCol(prev => Math.max(0, prev - 1));
      }
      return;
    }

    // Ignore other control keys
    if (key.ctrl || key.meta || key.escape) return;

    // Tab → insert spaces
    if (key.tab) {
      setValue(prev => prev + '  ');
      setCursorCol(prev => prev + 2);
      return;
    }

    // Regular character input
    if (input && !key.upArrow && !key.downArrow && !key.leftArrow && !key.rightArrow) {
      setValue(prev => prev + input);
      setCursorCol(prev => prev + input.length);
    }
  });

  const displayValue = value || '';
  const lines = displayValue.split('\n');
  const showPlaceholder = !displayValue && placeholder;

  return (
    <Box flexDirection="column">
      {showPlaceholder ? (
        <Text color={THEME.dim}>{prompt}{placeholder}</Text>
      ) : (
        lines.map((line, i) => (
          <Text key={i}>
            {i === 0 ? <Text color={THEME.accent} bold>{prompt}</Text> : <Text color={THEME.dim}>  </Text>}
            <Text>{line}</Text>
            {i === lines.length - 1 ? <Text color={THEME.accent}>█</Text> : null}
          </Text>
        ))
      )}
    </Box>
  );
}
