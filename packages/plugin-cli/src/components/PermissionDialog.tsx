import React from 'react';
import { Text, useInput } from 'ink';
import type { PendingToolCall, PermissionDecision } from '@moxxy/sdk';
import { Colors } from '../theme.js';
import { Modal } from './Modal.js';

/** Field names whose VALUES are likely secret material and must never be
 *  echoed verbatim on the approval prompt (terminal scrollback / logging). */
const SECRET_KEY = /(?:api[_-]?key|secret|token|password|passwd|passphrase|authorization|auth[_-]?token|bearer|credential|private[_-]?key|access[_-]?key)/i;
const REDACTED = '[redacted]';

/**
 * Shallow-redact secret-named fields in a tool-input object before display.
 * Length-capping is not redaction — a key/token in the args would otherwise
 * be printed verbatim on the exact surface where the user is deciding whether
 * to allow the call. Best-effort and bounded: only the top two object levels
 * are walked so a pathological deeply-nested input can't blow the stack.
 */
function redactForDisplay(value: unknown, depth = 0): unknown {
  if (depth > 2 || value == null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redactForDisplay(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SECRET_KEY.test(k) ? REDACTED : redactForDisplay(v, depth + 1);
  }
  return out;
}

/** Stringify tool input for the prompt, redacting secret-named fields and
 *  capping length. Never throws — a circular/unserializable input falls back
 *  to a safe marker. */
export function previewToolInput(input: unknown): string {
  try {
    return JSON.stringify(redactForDisplay(input)).slice(0, 200);
  } catch {
    return '[unserializable]';
  }
}

export interface PermissionDialogProps {
  readonly call: PendingToolCall;
  readonly toolDescription?: string;
  /**
   * How many additional requests are queued behind this one. Parallel
   * subagents can each request permission concurrently — surfacing the
   * depth tells the user they're about to make N decisions back-to-back.
   */
  readonly queueDepth?: number;
  readonly onDecide: (decision: PermissionDecision) => void;
}

export const PermissionDialog: React.FC<PermissionDialogProps> = ({
  call,
  toolDescription,
  queueDepth = 0,
  onDecide,
}) => {
  useInput((input, key) => {
    const ch = input.toLowerCase();
    if (ch === 'y' || key.return) onDecide({ mode: 'allow' });
    else if (ch === 'a') onDecide({ mode: 'allow_session' });
    else if (ch === 'p') onDecide({ mode: 'allow_always' });
    else if (ch === 'n' || key.escape) onDecide({ mode: 'deny', reason: 'user declined' });
  });

  const title =
    queueDepth > 0
      ? `Tool permission requested (${queueDepth} more queued)`
      : 'Tool permission requested';
  return (
    <Modal title={title} hints="y allow · a session · p always · n deny">
      <Text>
        Tool: <Text bold>{call.name}</Text>
        {toolDescription ? <Text dimColor> — {toolDescription}</Text> : null}
      </Text>
      <Text dimColor>Input: {previewToolInput(call.input)}</Text>
      <Text>
        <Text>[y]</Text>
        <Text dimColor> allow once · </Text>
        <Text>[a]</Text>
        <Text dimColor> allow session · </Text>
        <Text>[p]</Text>
        <Text dimColor> always · </Text>
        <Text color={Colors.danger}>[n]</Text>
        <Text dimColor> deny</Text>
      </Text>
    </Modal>
  );
};
