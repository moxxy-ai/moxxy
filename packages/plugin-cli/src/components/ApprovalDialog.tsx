import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { ApprovalDecision, ApprovalRequest } from '@moxxy/sdk';

export interface ApprovalDialogProps {
  readonly request: ApprovalRequest;
  readonly onDecide: (decision: ApprovalDecision) => void;
}

/**
 * Generic approval dialog used by any loop strategy that wants to surface
 * a checkpoint to the user. Renders the request body verbatim, lets the
 * user pick an option by hotkey or arrow+enter, and — when the selected
 * option has `requestsText: true` — switches to a one-line text input
 * before resolving so the strategy gets follow-up feedback (e.g. "redraft
 * with: don't write so many docs").
 */
export const ApprovalDialog: React.FC<ApprovalDialogProps> = ({ request, onDecide }) => {
  const initialCursor = (() => {
    if (request.defaultOptionId) {
      const idx = request.options.findIndex((o) => o.id === request.defaultOptionId);
      if (idx >= 0) return idx;
    }
    return 0;
  })();
  const [cursor, setCursor] = useState(initialCursor);
  // When the user picks an option that needs follow-up text, switch into
  // a text-entry mode and keep the option preselected. Submit on Enter.
  const [textEntry, setTextEntry] = useState<{ optionId: string; buffer: string } | null>(
    null,
  );

  useInput((input, key) => {
    if (textEntry) {
      if (key.return) {
        onDecide({ optionId: textEntry.optionId, text: textEntry.buffer.trim() });
        return;
      }
      if (key.escape) {
        setTextEntry(null);
        return;
      }
      const isBackspace =
        key.backspace ||
        input === '\x7f' ||
        input === '\x08' ||
        (key.ctrl && input === 'h');
      if (isBackspace) {
        setTextEntry((t) => (t ? { ...t, buffer: t.buffer.slice(0, -1) } : t));
        return;
      }
      if (
        !key.meta &&
        !key.ctrl &&
        !key.return &&
        !key.backspace &&
        !key.delete &&
        !key.upArrow &&
        !key.downArrow &&
        !key.escape &&
        !key.tab &&
        input
      ) {
        const sanitized = input.replace(/[\r\t\v\f\x08\x7f]/g, '');
        if (sanitized) {
          setTextEntry((t) => (t ? { ...t, buffer: t.buffer + sanitized } : t));
        }
      }
      return;
    }

    // Hotkey shortcut: any option's `hotkey` resolves the dialog directly.
    const ch = input.toLowerCase();
    const hotkeyMatch = request.options.find((o) => o.hotkey === ch);
    if (hotkeyMatch) {
      pick(hotkeyMatch.id);
      return;
    }

    if (key.upArrow) {
      setCursor((c) => Math.max(0, c - 1));
      return;
    }
    if (key.downArrow) {
      setCursor((c) => Math.min(request.options.length - 1, c + 1));
      return;
    }
    if (key.return) {
      const opt = request.options[cursor];
      if (opt) pick(opt.id);
      return;
    }
    if (key.escape) {
      // Esc cancels via the option flagged `danger` (cancel/deny semantics)
      // when one exists; otherwise it's ignored so we don't accidentally
      // approve.
      const cancelOpt = request.options.find((o) => o.danger);
      if (cancelOpt) onDecide({ optionId: cancelOpt.id });
    }
  });

  const pick = (id: string): void => {
    const opt = request.options.find((o) => o.id === id);
    if (!opt) return;
    if (opt.requestsText) {
      setTextEntry({ optionId: id, buffer: '' });
      return;
    }
    onDecide({ optionId: id });
  };

  const bodyLines = request.body.split('\n');

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      paddingX={1}
      paddingY={0}
      marginTop={1}
    >
      <Text bold color="cyan">
        {request.title}
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {bodyLines.slice(0, 24).map((line, i) => (
          <Text key={i}>{line}</Text>
        ))}
        {bodyLines.length > 24 ? (
          <Text dimColor>… {bodyLines.length - 24} more line(s) hidden</Text>
        ) : null}
      </Box>

      {textEntry ? (
        <Box flexDirection="column" marginTop={1}>
          <Text color="yellow">
            {request.options.find((o) => o.id === textEntry.optionId)?.textPrompt ??
              'Type your message and press Enter (Esc to back out):'}
          </Text>
          <Box>
            <Text color="green">› </Text>
            <Text>{textEntry.buffer}</Text>
            <Text inverse> </Text>
          </Box>
        </Box>
      ) : (
        <Box flexDirection="column" marginTop={1}>
          {request.options.map((opt, i) => {
            const active = i === cursor;
            const prefix = active ? '› ' : '  ';
            const color = opt.danger ? 'red' : active ? 'green' : undefined;
            return (
              <Box key={opt.id}>
                <Text color={color}>{prefix}</Text>
                {opt.hotkey ? (
                  <Text color={color} bold={active}>
                    [{opt.hotkey}]{' '}
                  </Text>
                ) : null}
                <Text color={color} bold={active}>
                  {opt.label}
                </Text>
                {opt.description ? <Text dimColor> — {opt.description}</Text> : null}
              </Box>
            );
          })}
          <Box marginTop={1}>
            <Text dimColor>↑/↓ select · enter confirm · hotkey jumps · esc cancels</Text>
          </Box>
        </Box>
      )}
    </Box>
  );
};
