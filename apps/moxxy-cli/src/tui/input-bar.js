import { Box, Text } from 'ink';
import TextInputModule from 'ink-text-input';
import { useState, useCallback } from 'react';
import { h, COLORS } from './helpers.js';

const TextInput = TextInputModule.default || TextInputModule;

export function InputBar({ onSubmit, disabled, agentStatus }) {
  const [value, setValue] = useState('');

  const handleSubmit = useCallback((text) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    setValue('');
  }, [onSubmit]);

  const placeholder = disabled
    ? 'Connecting...'
    : agentStatus === 'running'
      ? 'Agent running... type next task'
      : 'Type a task and press Enter';

  return h(Box, {
    borderStyle: 'round',
    borderColor: COLORS.border,
    paddingX: 1,
  },
    h(Text, { color: COLORS.user, bold: true }, '> '),
    h(TextInput, {
      value,
      onChange: setValue,
      onSubmit: handleSubmit,
      placeholder,
      focus: !disabled,
    }),
    h(Box, { flexGrow: 1 }),
    h(Text, { color: COLORS.dim }, ' Ctrl+C quit'),
  );
}
