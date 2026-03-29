import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import { THEME } from '../theme.js';
import { matchCommands } from '../slash-commands.js';
import { resolveAutocompleteSelection } from '../input-utils.js';

function wordBoundaryLeft(text, pos) {
  let i = pos - 1;
  while (i > 0 && /\s/.test(text[i])) i--;
  while (i > 0 && !/\s/.test(text[i - 1])) i--;
  return Math.max(0, i);
}

function wordBoundaryRight(text, pos) {
  let i = pos;
  while (i < text.length && /\s/.test(text[i])) i++;
  while (i < text.length && !/\s/.test(text[i])) i++;
  return i;
}

export function InputArea({ onSubmit, onExit, onStop, pendingAsk, agent, disabled = false }) {
  const [inputValue, setInputValue] = useState('');
  const [cursor, setCursor] = useState(0);
  const [selectedMatchIndex, setSelectedMatchIndex] = useState(0);
  // anchor !== null means there's an active selection between anchor and cursor
  const [anchor, setAnchor] = useState(null);

  const valRef = useRef(inputValue);
  const curRef = useRef(cursor);
  const anchorRef = useRef(anchor);
  valRef.current = inputValue;
  curRef.current = cursor;
  anchorRef.current = anchor;

  const matches = inputValue.startsWith('/') ? matchCommands(inputValue) : [];
  const autocompleteIndex = Math.min(selectedMatchIndex, Math.max(0, matches.length - 1));

  const hasSelection = anchor !== null && anchor !== cursor;
  const selStart = hasSelection ? Math.min(anchor, cursor) : cursor;
  const selEnd = hasSelection ? Math.max(anchor, cursor) : cursor;

  // Delete selection and return new { value, cursor }
  const deleteSelection = useCallback(() => {
    const a = anchorRef.current;
    const c = curRef.current;
    const v = valRef.current;
    if (a === null || a === c) return null;
    const s = Math.min(a, c);
    const e = Math.max(a, c);
    return { value: v.slice(0, s) + v.slice(e), cursor: s };
  }, []);

  const clearSelection = useCallback(() => setAnchor(null), []);

  const handleSubmit = useCallback((value) => {
    const text = typeof value === 'string' ? value : '';
    if (text.trim()) {
      onSubmit(text);
      setInputValue('');
      setCursor(0);
      setAnchor(null);
    }
  }, [onSubmit]);

  useEffect(() => {
    setSelectedMatchIndex(0);
  }, [inputValue, matches.length]);

  // Raw stdin listener for Option+Backspace (\x1b\x7f)
  useEffect(() => {
    const stream = process.stdin;
    const onData = (data) => {
      if (disabled) return;
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
      if (buf.length === 2 && buf[0] === 0x1b && buf[1] === 0x7f) {
        const val = valRef.current;
        const c = curRef.current;
        const a = anchorRef.current;
        // If there's a selection, delete it
        if (a !== null && a !== c) {
          const s = Math.min(a, c);
          const e = Math.max(a, c);
          setInputValue(val.slice(0, s) + val.slice(e));
          setCursor(s);
          setAnchor(null);
        } else if (c > 0) {
          const pos = wordBoundaryLeft(val, c);
          setInputValue(val.slice(0, pos) + val.slice(c));
          setCursor(pos);
          setAnchor(null);
        }
      }
    };
    stream.prependListener('data', onData);
    return () => stream.removeListener('data', onData);
  }, [disabled]);

  useInput((input, key) => {
    if (disabled) return;

    // Ctrl+C
    if (key.ctrl && input === 'c') {
      if (inputValue.length > 0) {
        setInputValue('');
        setCursor(0);
        setAnchor(null);
      } else {
        onExit();
      }
      return;
    }

    // Enter → submit
    if (key.return && !key.shift) {
      const selectedCommand = resolveAutocompleteSelection(inputValue, matches, autocompleteIndex);
      if (selectedCommand) {
        setInputValue(selectedCommand);
        setCursor(selectedCommand.length);
        setAnchor(null);
        return;
      }

      handleSubmit(inputValue);
      return;
    }

    // Shift+Enter → newline
    if (key.return && key.shift) {
      if (hasSelection) {
        const d = deleteSelection();
        if (d) {
          setInputValue(d.value.slice(0, d.cursor) + '\n' + d.value.slice(d.cursor));
          setCursor(d.cursor + 1);
          setAnchor(null);
          return;
        }
      }
      setInputValue(prev => prev.slice(0, cursor) + '\n' + prev.slice(cursor));
      setCursor(c => c + 1);
      setAnchor(null);
      return;
    }

    // Backspace
    if (key.backspace || key.delete) {
      if (hasSelection) {
        const d = deleteSelection();
        if (d) {
          setInputValue(d.value);
          setCursor(d.cursor);
          setAnchor(null);
        }
      } else if (cursor > 0) {
        setInputValue(prev => prev.slice(0, cursor - 1) + prev.slice(cursor));
        setCursor(c => c - 1);
      }
      return;
    }

    // Tab → autocomplete
    if (key.tab && matches.length > 0) {
      const selected = matches[autocompleteIndex] || matches[0];
      setInputValue(selected.name);
      setCursor(selected.name.length);
      setAnchor(null);
      return;
    }

    // Shift+Left - extend selection left
    if (key.shift && key.leftArrow) {
      if (anchor === null) setAnchor(cursor);
      setCursor(c => Math.max(0, c - 1));
      return;
    }

    // Shift+Right - extend selection right
    if (key.shift && key.rightArrow) {
      if (anchor === null) setAnchor(cursor);
      setCursor(c => Math.min(inputValue.length, c + 1));
      return;
    }

    // Option+Left - jump word left
    if (key.meta && key.leftArrow) {
      setCursor(c => wordBoundaryLeft(inputValue, c));
      setAnchor(null);
      return;
    }

    // Option+Right - jump word right
    if (key.meta && key.rightArrow) {
      setCursor(c => wordBoundaryRight(inputValue, c));
      setAnchor(null);
      return;
    }

    // Left arrow - move or collapse selection
    if (key.leftArrow) {
      if (hasSelection) {
        setCursor(selStart);
        setAnchor(null);
      } else {
        setCursor(c => Math.max(0, c - 1));
      }
      return;
    }

    // Right arrow - move or collapse selection
    if (key.rightArrow) {
      if (hasSelection) {
        setCursor(selEnd);
        setAnchor(null);
      } else {
        setCursor(c => Math.min(inputValue.length, c + 1));
      }
      return;
    }

    // Ctrl+W - delete word before cursor
    if (key.ctrl && input === 'w') {
      if (hasSelection) {
        const d = deleteSelection();
        if (d) { setInputValue(d.value); setCursor(d.cursor); setAnchor(null); }
      } else if (cursor > 0) {
        const pos = wordBoundaryLeft(inputValue, cursor);
        setInputValue(prev => prev.slice(0, pos) + prev.slice(cursor));
        setCursor(pos);
      }
      return;
    }

    // Ctrl+A - select all or move to start
    if (key.ctrl && input === 'a') {
      if (inputValue.length > 0) {
        setAnchor(0);
        setCursor(inputValue.length);
      }
      return;
    }

    // Ctrl+E - move to end
    if (key.ctrl && input === 'e') {
      setCursor(inputValue.length);
      setAnchor(null);
      return;
    }

    // Ctrl+U - delete everything before cursor
    if (key.ctrl && input === 'u') {
      setInputValue(prev => prev.slice(cursor));
      setCursor(0);
      setAnchor(null);
      return;
    }

    // Ctrl+K - delete everything after cursor
    if (key.ctrl && input === 'k') {
      setInputValue(prev => prev.slice(0, cursor));
      setAnchor(null);
      return;
    }

    // Ignore other control/meta keys
    if (key.ctrl || key.meta || key.escape) return;

    // Up/down arrows - navigate slash command suggestions
    if (matches.length > 0 && key.upArrow) {
      setSelectedMatchIndex(prev => Math.max(0, prev - 1));
      return;
    }

    if (matches.length > 0 && key.downArrow) {
      setSelectedMatchIndex(prev => Math.min(matches.length - 1, prev + 1));
      return;
    }

    // Regular character input
    if (input) {
      if (hasSelection) {
        const d = deleteSelection();
        if (d) {
          setInputValue(d.value.slice(0, d.cursor) + input + d.value.slice(d.cursor));
          setCursor(d.cursor + input.length);
          setAnchor(null);
          return;
        }
      }
      setInputValue(prev => prev.slice(0, cursor) + input + prev.slice(cursor));
      setCursor(c => c + input.length);
      setAnchor(null);
    }
  });

  const prompt = pendingAsk ? '? ' : '› ';
  const showPlaceholder = !inputValue;
  const placeholderText = pendingAsk ? 'Type your answer...' : 'Type a message or /command...';

  // Render text with selection highlighting
  let renderedInput;
  if (showPlaceholder) {
    renderedInput = <Text color={THEME.dim}>{placeholderText}</Text>;
  } else if (hasSelection) {
    const before = inputValue.slice(0, selStart);
    const selected = inputValue.slice(selStart, selEnd);
    const after = inputValue.slice(selEnd);
    renderedInput = (
      <Text>
        {before}
        <Text backgroundColor="white" color="black">{selected}</Text>
        {after}
      </Text>
    );
  } else {
    const before = inputValue.slice(0, cursor);
    const after = inputValue.slice(cursor);
    renderedInput = (
      <Text>
        {before}
        <Text color={THEME.accent}>█</Text>
        {after}
      </Text>
    );
  }

  return (
    <Box flexDirection="column" width="100%" flexShrink={0}>
      {matches.length > 0 && (
        <Box flexDirection="column" width="100%" paddingX={1}>
          {matches.slice(0, 8).map((cmd, i) => (
            <Box key={cmd.name}>
              <Text>
                {i === autocompleteIndex
                  ? <><Text bold color={THEME.primary}>{cmd.name}</Text><Text color={THEME.text}> - {cmd.description}</Text></>
                  : <><Text color={THEME.dim}>{cmd.name}</Text><Text color={THEME.dim}> - {cmd.description}</Text></>
                }
              </Text>
            </Box>
          ))}
        </Box>
      )}
      <Box
        width="100%"
        flexDirection="row"
        borderStyle="round"
        borderColor={matches.length > 0 ? THEME.primary : THEME.border}
        paddingX={1}
      >
        <Text bold color={THEME.accent}>{prompt}</Text>
        {renderedInput}
      </Box>
      <Box width="100%" paddingX={1} justifyContent="space-between">
        <Text color={THEME.dim}> ^C exit  ^X stop  ^T tools  ^A select all  /help</Text>
        {agent && (
          <Text color={THEME.dim}>
            {agent.name || agent.id}{agent.model_id ? ` · ${agent.model_id}` : ''}
          </Text>
        )}
      </Box>
    </Box>
  );
}
