import React from 'react';
import { Text } from 'ink';

export const BufferLines: React.FC<{
  buffer: string;
  cursor: number;
  disabled: boolean;
  placeholder?: string;
}> = ({ buffer, cursor, disabled, placeholder }) => {
  const empty = buffer.length === 0;
  const lines = empty ? [''] : buffer.split('\n');
  const { lineIdx, colIdx } = locateCursor(buffer, cursor);
  // Each logical line is rendered as ONE <Text>. The cursor glyph (▌) is
  // a nested colored child of that same Text — Ink squashes everything
  // into a single string before measuring/wrapping, so wrap-ansi keeps
  // the cursor in its true position when a long line spills to the next
  // terminal row. Sibling Text nodes get their own yoga rects: a long
  // first sibling that wrapped to two rows would still place the next
  // sibling at (x=width, y=0) — i.e. the right edge of the FIRST row —
  // which produced the "cursor stuck on line 1" symptom.
  return (
    <>
      {lines.map((line, i) => {
        const prefix = i === 0 ? (disabled ? '… ' : '› ') : '  ';
        const prefixColor = i === 0 ? (disabled ? 'gray' : 'green') : undefined;
        const isCursorLine = i === lineIdx && !disabled;
        const before = isCursorLine ? line.slice(0, colIdx) : line;
        const after = isCursorLine ? line.slice(colIdx) : '';
        const showPlaceholder = i === lines.length - 1 && empty && !!placeholder;
        return (
          <Text key={i}>
            <Text color={prefixColor}>{prefix}</Text>
            {before}
            {isCursorLine ? <Text color="green">▌</Text> : null}
            {after}
            {showPlaceholder ? <Text dimColor>{placeholder}</Text> : null}
          </Text>
        );
      })}
    </>
  );
};

function locateCursor(buffer: string, cursor: number): { lineIdx: number; colIdx: number } {
  let lineIdx = 0;
  let lineStart = 0;
  for (let i = 0; i < cursor; i += 1) {
    if (buffer[i] === '\n') {
      lineIdx += 1;
      lineStart = i + 1;
    }
  }
  return { lineIdx, colIdx: cursor - lineStart };
}
