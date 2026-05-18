import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { ApprovalDecision, ApprovalRequest } from '@moxxy/sdk';
import { Colors } from '../theme.js';
import { Modal } from './Modal.js';

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
    // Digit jump: "1"–"9" maps to the corresponding (1-indexed) option.
    if (/^[1-9]$/.test(ch)) {
      const idx = Number.parseInt(ch, 10) - 1;
      const opt = request.options[idx];
      if (opt) {
        pick(opt.id);
        return;
      }
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
  const hints = textEntry
    ? 'Enter submit · Esc back'
    : '↑↓ navigate · Enter select · digit jumps · Esc cancel';

  return (
    <Modal title={request.title} hints={hints}>
      {bodyLines.length > 0 && bodyLines[0] !== '' ? (
        <Box flexDirection="column" marginBottom={1}>
          {bodyLines.slice(0, 24).map((line, i) => (
            <Text key={i}>{line}</Text>
          ))}
          {bodyLines.length > 24 ? (
            <Text dimColor>… {bodyLines.length - 24} more line(s) hidden</Text>
          ) : null}
        </Box>
      ) : null}

      {textEntry ? (
        <Box flexDirection="column">
          <Text dimColor>
            {request.options.find((o) => o.id === textEntry.optionId)?.textPrompt ??
              'Type your message and press Enter (Esc to back out):'}
          </Text>
          <Box>
            <Text>› </Text>
            <Text>{textEntry.buffer}</Text>
            <Text inverse> </Text>
          </Box>
        </Box>
      ) : (
        <Box flexDirection="column">
          {request.options.map((opt, i) => {
            const active = i === cursor;
            const isDanger = !!opt.danger;
            const radio = active ? '●' : '○';
            const numLabel = opt.hotkey ?? String(i + 1);
            return (
              <Box key={opt.id}>
                <Box width={4}>
                  <Text {...(active ? {} : { dimColor: true })}>{numLabel}</Text>
                </Box>
                <Text
                  {...(isDanger
                    ? { color: Colors.danger }
                    : active
                      ? {}
                      : { dimColor: true })}
                >
                  {`(${radio}) `}
                </Text>
                <Box width={24}>
                  <Text
                    bold={active}
                    {...(isDanger ? { color: Colors.danger } : active ? {} : { dimColor: true })}
                  >
                    {opt.label}
                  </Text>
                </Box>
                {opt.description ? (
                  <Text dimColor>{opt.description}</Text>
                ) : null}
              </Box>
            );
          })}
        </Box>
      )}
    </Modal>
  );
};
