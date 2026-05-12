import React, { useReducer, useState } from 'react';
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

/**
 * Buffered input with a movable cursor + slash-command dropdown.
 *
 * The buffer + cursor live in ONE state object updated via useReducer so
 * every keypress sees the latest cursor/buffer pair atomically. The
 * previous useState pair had a race: under fast typing, the input-handler
 * closure captured a stale `cursor`, which then desynced from the
 * latest buffer and made backspace delete the wrong character (or
 * no-op when the captured cursor looked like 0). useReducer's `prev`
 * argument always reflects the latest committed state, so the bug
 * can't recur.
 */
export const PromptInput: React.FC<PromptInputProps> = ({
  onSubmit,
  disabled,
  placeholder,
  slashCommands = BUILTIN_SLASH_COMMANDS,
}) => {
  const [{ buffer, cursor }, dispatch] = useReducer(reducer, INITIAL);
  const [slashCursor, setSlashCursor] = useState(0);

  const slashEligible = buffer.startsWith('/') && !buffer.includes('\n');
  const slashMatches: ReadonlyArray<SlashCommand> = slashEligible
    ? matchSlash(buffer, slashCommands)
    : [];

  useInput((input, key) => {
    if (disabled) return;

    // ── 1. Backspace ────────────────────────────────────────────────
    // Runs first so it can never be shadowed.
    const isBackspace =
      key.backspace ||
      input === '\x7f' ||
      input === '\x08' ||
      (key.ctrl && input === 'h');
    if (isBackspace) {
      dispatch({ type: 'backspace' });
      setSlashCursor(0);
      return;
    }

    // ── 2. Forward-delete ───────────────────────────────────────────
    const isForwardDelete = key.delete || input === '\x1b[3~';
    if (isForwardDelete) {
      dispatch({ type: 'delete-forward' });
      setSlashCursor(0);
      return;
    }

    // ── 3. Slash dropdown nav (up/down/tab) ─────────────────────────
    if (slashMatches.length > 0) {
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
          dispatch({ type: 'set', buffer: `/${picked.name}`, cursor: picked.name.length + 1 });
          setSlashCursor(0);
        }
        return;
      }
    }

    // ── 4. Cursor motion ────────────────────────────────────────────
    if (key.leftArrow) {
      dispatch({ type: key.meta ? 'word-left' : 'left' });
      return;
    }
    if (key.rightArrow) {
      dispatch({ type: key.meta ? 'word-right' : 'right' });
      return;
    }
    if (key.ctrl && input === 'a') {
      dispatch({ type: 'line-start' });
      return;
    }
    if (key.ctrl && input === 'e') {
      dispatch({ type: 'line-end' });
      return;
    }

    // ── 5. Return: submit or line continuation ─────────────────────
    if (key.return) {
      if (cursor > 0 && buffer[cursor - 1] === '\\') {
        dispatch({ type: 'line-continuation' });
        return;
      }
      const trimmed = buffer.trim();
      dispatch({ type: 'reset' });
      setSlashCursor(0);
      if (trimmed) onSubmit(trimmed);
      return;
    }

    // ── 6. Escape / exit ───────────────────────────────────────────
    if (key.escape) {
      dispatch({ type: 'reset' });
      setSlashCursor(0);
      return;
    }
    if (key.ctrl && input === 'c') {
      process.exit(0);
    }

    // ── 7. Printable input ─────────────────────────────────────────
    if (
      !key.meta &&
      !key.ctrl &&
      !key.return &&
      !key.backspace &&
      !key.delete &&
      !key.upArrow &&
      !key.downArrow &&
      !key.leftArrow &&
      !key.rightArrow &&
      !key.escape &&
      !key.tab &&
      input
    ) {
      const sanitized = input.replace(/[\r\t\v\f\x08\x7f]/g, '');
      if (sanitized) {
        dispatch({ type: 'insert', text: sanitized });
        setSlashCursor(0);
      }
    }
  });

  // ── Render ─────────────────────────────────────────────────────────
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
          consumed += line.length + 1;

          const prefix = i === 0 ? (disabled ? '… ' : '› ') : '  ';
          const prefixColor = i === 0 ? (disabled ? 'gray' : 'green') : undefined;

          if (isEmpty && i === 0) {
            return (
              <Box key={i}>
                <Text color={prefixColor}>{prefix}</Text>
                {!disabled ? <Text inverse>{' '}</Text> : null}
                {placeholder ? <Text dimColor>{placeholder}</Text> : null}
              </Box>
            );
          }
          if (!inThisLine || disabled) {
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

// ── State + reducer ───────────────────────────────────────────────────

interface InputState {
  readonly buffer: string;
  readonly cursor: number;
}

const INITIAL: InputState = { buffer: '', cursor: 0 };

type Action =
  | { type: 'insert'; text: string }
  | { type: 'backspace' }
  | { type: 'delete-forward' }
  | { type: 'left' }
  | { type: 'right' }
  | { type: 'word-left' }
  | { type: 'word-right' }
  | { type: 'line-start' }
  | { type: 'line-end' }
  | { type: 'line-continuation' }
  | { type: 'reset' }
  | { type: 'set'; buffer: string; cursor: number };

function reducer(state: InputState, action: Action): InputState {
  const { buffer, cursor } = state;
  switch (action.type) {
    case 'insert': {
      const next = buffer.slice(0, cursor) + action.text + buffer.slice(cursor);
      return { buffer: next, cursor: cursor + action.text.length };
    }
    case 'backspace': {
      if (cursor === 0) return state;
      return {
        buffer: buffer.slice(0, cursor - 1) + buffer.slice(cursor),
        cursor: cursor - 1,
      };
    }
    case 'delete-forward': {
      if (cursor >= buffer.length) return state;
      return {
        buffer: buffer.slice(0, cursor) + buffer.slice(cursor + 1),
        cursor,
      };
    }
    case 'left':
      return { buffer, cursor: Math.max(0, cursor - 1) };
    case 'right':
      return { buffer, cursor: Math.min(buffer.length, cursor + 1) };
    case 'word-left':
      return { buffer, cursor: moveWordBackward(buffer, cursor) };
    case 'word-right':
      return { buffer, cursor: moveWordForward(buffer, cursor) };
    case 'line-start':
      return { buffer, cursor: lineStart(buffer, cursor) };
    case 'line-end':
      return { buffer, cursor: lineEnd(buffer, cursor) };
    case 'line-continuation': {
      // Consume the trailing `\` before the cursor, insert a newline.
      if (cursor === 0 || buffer[cursor - 1] !== '\\') return state;
      return {
        buffer: buffer.slice(0, cursor - 1) + '\n' + buffer.slice(cursor),
        cursor, // unchanged: removed 1, inserted 1
      };
    }
    case 'reset':
      return INITIAL;
    case 'set':
      return { buffer: action.buffer, cursor: action.cursor };
  }
}

// ── Word-jump helpers (bash readline semantics) ──────────────────────

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
