import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { ApprovalDecision, ApprovalRequest } from '@moxxy/sdk';
import { Colors } from '../theme.js';
import { Modal } from './Modal.js';

export interface ApprovalDialogProps {
  readonly request: ApprovalRequest;
  readonly onDecide: (decision: ApprovalDecision) => void;
}

/** Maximum body lines rendered in one frame. Larger bodies become scrollable. */
const MAX_BODY_LINES = 20;

type LineRender = { readonly text: string; readonly color?: string; readonly dim?: boolean };

/**
 * Recognize diff-flavored content so the body can be colorized. Either a
 * fenced ```diff block (preferred — explicit) or a body that starts with
 * a `diff --git` line works.
 */
function isDiffBody(body: string): boolean {
  return /```diff\b/.test(body) || /^\s*diff --git\b/m.test(body);
}

/**
 * Render a single body line with diff-style coloring when inside a fenced
 * diff block (or when the entire body is treated as diff content). Fence
 * markers themselves are suppressed.
 */
function renderDiffLines(bodyLines: ReadonlyArray<string>): LineRender[] {
  const wholeBodyIsDiff = bodyLines.some((l) => /^\s*diff --git\b/.test(l));
  let inFence = wholeBodyIsDiff;
  const out: LineRender[] = [];
  for (const line of bodyLines) {
    // Toggle on/off when we see ```diff or a closing ``` (only meaningful
    // when fences are present — if the body is raw diff, fences never
    // appear and inFence stays true throughout).
    if (/^```diff\b/.test(line.trim())) {
      inFence = true;
      continue;
    }
    if (inFence && line.trim() === '```') {
      if (!wholeBodyIsDiff) inFence = false;
      continue;
    }
    if (!inFence) {
      out.push({ text: line });
      continue;
    }
    // Coloring rules — match before generic +/- to avoid eating headers.
    if (/^(diff --git|index |---|\+\+\+)/.test(line)) {
      out.push({ text: line, dim: true });
    } else if (/^@@/.test(line)) {
      out.push({ text: line, color: 'cyan' });
    } else if (line.startsWith('+')) {
      out.push({ text: line, color: 'green' });
    } else if (line.startsWith('-')) {
      out.push({ text: line, color: 'red' });
    } else {
      out.push({ text: line });
    }
  }
  return out;
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
  // Scroll offset for long bodies (diff previews, etc). j/k or PgDn/PgUp
  // walk through; ↑/↓ still control option navigation, so the two never
  // collide.
  const [scrollOffset, setScrollOffset] = useState(0);

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

    // Body scroll: j/k or PgDn/PgUp move through long bodies (e.g. diffs).
    // Handled BEFORE hotkey/digit matching so a binding like hotkey='j'
    // doesn't accidentally shadow scroll. No-op when the body fits.
    if (input === 'j' || key.pageDown) {
      setScrollOffset((o) => o + Math.max(1, Math.floor(MAX_BODY_LINES / 2)));
      return;
    }
    if (input === 'k' || key.pageUp) {
      setScrollOffset((o) => Math.max(0, o - Math.max(1, Math.floor(MAX_BODY_LINES / 2))));
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

  const rawLines = request.body.split('\n');
  const diffMode = isDiffBody(request.body);
  const rendered: LineRender[] = diffMode
    ? renderDiffLines(rawLines)
    : rawLines.map((text) => ({ text }));

  // Clamp scrollOffset so we don't end up looking past the bottom when
  // the body is short or the user paged down past the end.
  const maxOffset = Math.max(0, rendered.length - MAX_BODY_LINES);
  const offset = Math.min(scrollOffset, maxOffset);
  const visible = rendered.slice(offset, offset + MAX_BODY_LINES);
  const hiddenBefore = offset;
  const hiddenAfter = Math.max(0, rendered.length - offset - visible.length);

  const baseHints = textEntry
    ? 'Enter submit · Esc back'
    : '↑↓ navigate · Enter select · digit jumps · Esc cancel';
  const hints =
    !textEntry && rendered.length > MAX_BODY_LINES
      ? `${baseHints} · j/k scroll`
      : baseHints;

  return (
    <Modal title={request.title} hints={hints}>
      {rendered.length > 0 && rendered[0]?.text !== '' ? (
        <Box flexDirection="column" marginBottom={1}>
          {hiddenBefore > 0 ? (
            <Text dimColor>↑ {hiddenBefore} earlier line(s) — k/PgUp</Text>
          ) : null}
          {visible.map((line, i) => (
            <Text key={i} {...(line.color ? { color: line.color } : {})} {...(line.dim ? { dimColor: true } : {})}>
              {line.text}
            </Text>
          ))}
          {hiddenAfter > 0 ? (
            <Text dimColor>↓ {hiddenAfter} more line(s) — j/PgDn</Text>
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
