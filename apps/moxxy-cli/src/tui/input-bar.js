import { Box, Text, useInput } from 'ink';
import TextInputModule from 'ink-text-input';
import { useState, useCallback, useEffect } from 'react';
import { h, COLORS } from './helpers.js';
import { matchCommands, isSlashCommand } from './slash-commands.js';
import { SlashPopup } from './slash-popup.js';

const TextInput = TextInputModule.default || TextInputModule;

export function InputBar({ onSubmit, disabled, agentStatus }) {
  const [value, setValue] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  const matches = isSlashCommand(value) ? matchCommands(value) : [];
  const showPopup = matches.length > 0;

  useEffect(() => {
    setSelectedIndex(0);
  }, [matches.length, value]);

  useInput((input, key) => {
    if (!showPopup) return;
    if (key.upArrow) {
      setSelectedIndex(prev => Math.max(0, prev - 1));
    }
    if (key.downArrow) {
      setSelectedIndex(prev => Math.min(matches.length - 1, prev + 1));
    }
    if (key.tab) {
      if (matches[selectedIndex]) {
        setValue(matches[selectedIndex].name);
      }
    }
  }, { isActive: showPopup && !disabled });

  const handleSubmit = useCallback((text) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    // If popup is showing, use the selected command
    if (showPopup && matches[selectedIndex]) {
      onSubmit(matches[selectedIndex].name);
      setValue('');
      return;
    }

    onSubmit(trimmed);
    setValue('');
  }, [onSubmit, showPopup, matches, selectedIndex]);

  const placeholder = disabled
    ? 'Connecting...'
    : agentStatus === 'running'
      ? 'Agent running... type next task'
      : 'Type a task (/ for commands)';

  return h(Box, { flexDirection: 'column' },
    showPopup
      ? h(SlashPopup, { commands: matches, selectedIndex })
      : null,
    h(Box, {
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
    ),
  );
}
