import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

export interface PromptInputProps {
  readonly onSubmit: (value: string) => void;
  readonly disabled?: boolean;
  readonly placeholder?: string;
}

export const PromptInput: React.FC<PromptInputProps> = ({ onSubmit, disabled, placeholder }) => {
  const [buffer, setBuffer] = useState('');

  useInput((input, key) => {
    if (disabled) return;
    if (key.return) {
      const trimmed = buffer.trim();
      setBuffer('');
      if (trimmed) onSubmit(trimmed);
      return;
    }
    if (key.backspace || key.delete) {
      setBuffer((b) => b.slice(0, -1));
      return;
    }
    if (key.escape) {
      setBuffer('');
      return;
    }
    if (key.ctrl && input === 'c') {
      process.exit(0);
    }
    if (!key.meta && !key.ctrl && input && input.length === 1) {
      setBuffer((b) => b + input);
    }
  });

  return (
    <Box>
      <Text color={disabled ? 'gray' : 'green'}>{disabled ? '… ' : '› '}</Text>
      <Text>{buffer || (placeholder ? <Text dimColor>{placeholder}</Text> : '')}</Text>
    </Box>
  );
};
