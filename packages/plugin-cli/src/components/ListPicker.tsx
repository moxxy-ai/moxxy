import React, { useState } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import { Colors } from '../theme.js';
import { Modal } from './Modal.js';

export interface ListPickerOption {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly group?: string;
  readonly current?: boolean;
  /**
   * When set, renders as a small colored tag after the label
   * (e.g. "not connected"). Use `badgeColor` to override the default.
   */
  readonly badge?: string;
  readonly badgeColor?: 'red' | 'yellow' | 'green' | 'gray' | 'cyan';
}

export interface ListPickerProps {
  readonly title: string;
  readonly options: ReadonlyArray<ListPickerOption>;
  readonly onSelect: (id: string) => void;
  readonly onCancel: () => void;
}

/**
 * Generic up/down + enter picker. Used by /model and /loop to let the
 * user swap a session-level setting from inside the TUI. Options can
 * declare a `group` and a `current` flag so the picker can visually
 * cluster related items (e.g., models grouped by provider) and tag the
 * one that's already active.
 */
export const ListPicker: React.FC<ListPickerProps> = ({ title, options, onSelect, onCancel }) => {
  const initial = Math.max(0, options.findIndex((o) => o.current));
  const [cursor, setCursor] = useState(initial);

  useInput((input, key) => {
    if (key.escape || (key.ctrl && input === 'c')) {
      onCancel();
      return;
    }
    if (key.upArrow) {
      setCursor((c) => Math.max(0, c - 1));
      return;
    }
    if (key.downArrow) {
      setCursor((c) => Math.min(options.length - 1, c + 1));
      return;
    }
    if (key.return) {
      const picked = options[cursor];
      if (picked) onSelect(picked.id);
    }
  });

  // Window the list to the terminal height. The picker renders in the TUI's
  // LIVE (non-Static) region; if the rendered box is taller than the terminal,
  // its top lines scroll into the persistent scrollback and Ink can no longer
  // erase them on close — leaving a ghost copy of the list behind. Showing a
  // cursor-following slice keeps the box bounded, so it always clears cleanly.
  const { stdout } = useStdout();
  const termRows = stdout?.rows ?? 24;
  // Reserve rows for the modal chrome (border/title/hints ≈ 8), the scroll
  // indicators (2), the persistent status line, and a little breathing room.
  const maxVisible = Math.max(4, Math.min(options.length, termRows - 14));

  let start = 0;
  if (options.length > maxVisible) {
    const half = Math.floor(maxVisible / 2);
    start = Math.min(Math.max(0, cursor - half), options.length - maxVisible);
  }
  const end = Math.min(options.length, start + maxVisible);
  const moreAbove = start;
  const moreBelow = options.length - end;

  return (
    <Modal
      title={title}
      subtitle={`${cursor + 1} of ${options.length}`}
      hints="↑↓ navigate · Enter select · Esc close"
    >
      <Box flexDirection="column">
        {moreAbove > 0 ? <Text dimColor>{`  ↑ ${moreAbove} more`}</Text> : null}
        {options.slice(start, end).map((opt, idx) => {
          const i = start + idx;
          // Show a group header when this row opens a new group — compared to
          // the option above it in the FULL list, so the top visible row still
          // shows which group it belongs to.
          const prevGroup = i > 0 ? options[i - 1]!.group : undefined;
          const showHeader = opt.group != null && opt.group !== prevGroup;
          const focused = i === cursor;
          return (
            <React.Fragment key={opt.id}>
              {showHeader ? (
                <Box marginTop={idx === 0 ? 0 : 1}>
                  <Text dimColor>{opt.group}</Text>
                </Box>
              ) : null}
              <Box>
                <Text {...(focused ? {} : { dimColor: true })}>{focused ? '› ' : '  '}</Text>
                <Text {...(focused ? { bold: true } : {})}>{opt.label}</Text>
                {opt.current ? <Text dimColor>{' (current)'}</Text> : null}
                {opt.badge ? (
                  <Text color={opt.badgeColor === 'red' ? Colors.danger : (opt.badgeColor ?? Colors.danger)}>
                    {`  [${opt.badge}]`}
                  </Text>
                ) : null}
                {opt.description ? (
                  <Text dimColor>{`  — ${opt.description}`}</Text>
                ) : null}
              </Box>
            </React.Fragment>
          );
        })}
        {moreBelow > 0 ? <Text dimColor>{`  ↓ ${moreBelow} more`}</Text> : null}
      </Box>
    </Modal>
  );
};
