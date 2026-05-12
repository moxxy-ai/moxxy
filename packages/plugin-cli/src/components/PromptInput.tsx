import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import {
  BUILTIN_SLASH_COMMANDS,
  matchSlash,
  SlashSuggestions,
  type SlashCommand,
} from './SlashCommands.js';

export interface PromptInputProps {
  readonly onSubmit: (value: string) => void;
  readonly disabled?: boolean;
  readonly placeholder?: string;
  readonly slashCommands?: ReadonlyArray<SlashCommand>;
}

export const PromptInput: React.FC<PromptInputProps> = ({
  onSubmit,
  disabled,
  placeholder,
  slashCommands = BUILTIN_SLASH_COMMANDS,
}) => {
  const [buffer, setBuffer] = useState('');
  const [cursor, setCursor] = useState(0);
  const [slashCursor, setSlashCursor] = useState(0);

  const slashEligible = buffer.startsWith('/') && !buffer.includes('\n');
  const slashMatches: ReadonlyArray<SlashCommand> = slashEligible
    ? matchSlash(buffer, slashCommands)
    : [];

  const insertAt = (text: string): void => {
    setBuffer((b) => b.slice(0, cursor) + text + b.slice(cursor));
    setCursor((c) => c + text.length);
  };

  const reset = (): void => {
    setBuffer('');
    setCursor(0);
    setSlashCursor(0);
  };

  useInput((input, key) => {
    if (disabled) return;

    if (slashMatches.length > 0) {
      // Up/down navigates the slash dropdown. Left/right still moves
      // the cursor in the buffer (the dropdown doesn't capture those).
      if (key.upArrow) {
        setSlashCursor((c) => Math.max(0, c - 1));
        return;
      }
      if (key.downArrow) {
        setSlashCursor((c) => Math.min(slashMatches.length - 1, c + 1));
        return;
      }
      if (key.tab) {
        const picked = slashMatches[Math.min(slashCursor, slashMatches.length - 1)];
        if (picked) {
          const next = `/${picked.name}`;
          setBuffer(next);
          setCursor(next.length);
          setSlashCursor(0);
        }
        return;
      }
    }

    // Cursor motion. Option/Alt + arrow = word-jump (bash/readline
    // convention). Plain arrow = single-char.
    if (key.leftArrow) {
      if (key.meta) setCursor((c) => moveWordBackward(buffer, c));
      else setCursor((c) => Math.max(0, c - 1));
      return;
    }
    if (key.rightArrow) {
      if (key.meta) setCursor((c) => moveWordForward(buffer, c));
      else setCursor((c) => Math.min(buffer.length, c + 1));
      return;
    }

    // Home / End — also handle Ctrl+A / Ctrl+E for bash habits.
    if (key.ctrl && input === 'a') {
      setCursor(lineStart(buffer, cursor));
      return;
    }
    if (key.ctrl && input === 'e') {
      setCursor(lineEnd(buffer, cursor));
      return;
    }

    if (key.return) {
      // Backslash-Enter: line continuation. Strip the trailing `\` and
      // insert a newline at the cursor; buffer stays open.
      if (cursor > 0 && buffer[cursor - 1] === '\\') {
        setBuffer((b) => b.slice(0, cursor - 1) + '\n' + b.slice(cursor));
        // cursor moves forward 0 net (removed 1, inserted 1)
        return;
      }
      const trimmed = buffer.trim();
      reset();
      if (trimmed) onSubmit(trimmed);
      return;
    }
    // Backspace handling. Different terminals report differently:
    //   - Ink usually sets `key.backspace=true` (sequence \x7f or \x08).
    //   - Some terminals deliver the byte alone via `input` without
    //     setting the flag, especially when Ctrl+H is bound to backspace.
    // Treat all three as backspace so the user isn't left with a dead key.
    const isBackspace =
      key.backspace ||
      input === '\x7f' ||
      input === '\x08' ||
      (key.ctrl && input === 'h');
    if (isBackspace) {
      if (cursor === 0) return;
      const pos = cursor;
      setBuffer((b) => b.slice(0, pos - 1) + b.slice(pos));
      setCursor((c) => Math.max(0, c - 1));
      setSlashCursor(0);
      return;
    }
    // Forward-delete (Fn+Delete on macOS, Delete on PC layouts). Same
    // dual-channel reporting as backspace.
    const isForwardDelete = key.delete || input === '\x1b[3~';
    if (isForwardDelete) {
      if (cursor >= buffer.length) return;
      const pos = cursor;
      setBuffer((b) => b.slice(0, pos) + b.slice(pos + 1));
      setSlashCursor(0);
      return;
    }
    if (key.escape) {
      reset();
      return;
    }
    if (key.ctrl && input === 'c') {
      process.exit(0);
    }
    // Accept printable input (single char or pasted block). Newlines
    // preserved (so a multi-line paste survives), tabs/CR stripped.
    // The extra `!key.backspace && !key.delete && !key.leftArrow && …`
    // guards stop us from re-inserting the DEL/BS byte that Ink also
    // passes alongside backspace/delete events — without that the user
    // sees "backspace doesn't work" because every delete is immediately
    // followed by re-inserting the literal control char.
    if (
      !key.meta &&
      !key.ctrl &&
      !key.return &&
      !key.backspace &&
      !key.delete &&
      !key.leftArrow &&
      !key.rightArrow &&
      !key.upArrow &&
      !key.downArrow &&
      !key.escape &&
      !key.tab &&
      input
    ) {
      // Also strip DEL (0x7f) and BS (0x08) explicitly in case the
      // terminal still smuggles them through with input non-empty.
      const sanitized = input.replace(/[\r\t\v\f\x08\x7f]/g, '');
      if (sanitized) {
        insertAt(sanitized);
        setSlashCursor(0);
      }
    }
  });

  // Render the buffer line-by-line, splicing in an inverse-video cursor
  // glyph at the current position. When the buffer is empty, the cursor
  // sits on the placeholder so the user can still see where input goes.
  const lines = buffer.length === 0 ? [''] : buffer.split('\n');
  const isEmpty = buffer.length === 0;
  let consumed = 0;

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box
        flexDirection="column"
        borderStyle="single"
        borderColor="gray"
        borderDimColor
        borderTop
        borderBottom
        borderLeft={false}
        borderRight={false}
      >
        {lines.map((line, i) => {
          const lineStartIdx = consumed;
          const cursorInLine = cursor - lineStartIdx;
          const inThisLine = cursorInLine >= 0 && cursorInLine <= line.length;
          consumed += line.length + 1; // +1 for '\n'

          const prefix = i === 0 ? (disabled ? '… ' : '› ') : '  ';
          const prefixColor = i === 0 ? (disabled ? 'gray' : 'green') : undefined;

          if (isEmpty && i === 0) {
            return (
              <Box key={i}>
                <Text color={prefixColor}>{prefix}</Text>
                <Text inverse>{' '}</Text>
                {placeholder ? <Text dimColor>{placeholder}</Text> : null}
              </Box>
            );
          }
          if (!inThisLine) {
            return (
              <Box key={i}>
                <Text color={prefixColor}>{prefix}</Text>
                <Text>{line}</Text>
              </Box>
            );
          }
          const before = line.slice(0, cursorInLine);
          const atChar = line[cursorInLine] ?? ' ';
          const after = line.slice(cursorInLine + 1);
          return (
            <Box key={i}>
              <Text color={prefixColor}>{prefix}</Text>
              <Text>{before}</Text>
              <Text inverse>{atChar}</Text>
              <Text>{after}</Text>
            </Box>
          );
        })}
      </Box>
      {slashMatches.length > 0 ? (
        <SlashSuggestions
          matches={slashMatches}
          cursor={Math.min(slashCursor, slashMatches.length - 1)}
        />
      ) : null}
    </Box>
  );
};

// Word-jump helpers — bash readline semantics. Forward: skip whitespace,
// then skip non-whitespace; land just past the end of the current word.
// Backward: mirror.

function moveWordForward(buf: string, pos: number): number {
  let i = pos;
  while (i < buf.length && /\s/.test(buf[i]!)) i++;
  while (i < buf.length && !/\s/.test(buf[i]!)) i++;
  return i;
}

function moveWordBackward(buf: string, pos: number): number {
  let i = pos;
  while (i > 0 && /\s/.test(buf[i - 1]!)) i--;
  while (i > 0 && !/\s/.test(buf[i - 1]!)) i--;
  return i;
}

function lineStart(buf: string, pos: number): number {
  const nl = buf.lastIndexOf('\n', pos - 1);
  return nl === -1 ? 0 : nl + 1;
}

function lineEnd(buf: string, pos: number): number {
  const nl = buf.indexOf('\n', pos);
  return nl === -1 ? buf.length : nl;
}
