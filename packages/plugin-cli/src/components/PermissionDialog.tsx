import path from 'node:path';
import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type {
  PendingToolCall,
  PermissionContext,
  PermissionDecision,
} from '@moxxy/sdk';
import { Colors } from '../theme.js';
import { Modal } from './Modal.js';
import { redactSecrets } from './redact.js';
import { terminalSafeText } from './terminal-text.js';

/** Stringify tool input only for the optional details view. */
export function previewToolInput(input: unknown): string {
  try {
    return JSON.stringify(redactSecrets(input)).slice(0, 200);
  } catch {
    return '[unserializable]';
  }
}

export interface PermissionPresentation {
  readonly title: string;
  readonly action: string;
  readonly targetLabel: string;
  readonly target: string;
  readonly impact: string;
  readonly sessionLabel: string;
  readonly sessionScope: { readonly inputKeys: ReadonlyArray<string> };
}

/** Translate an internal tool request into the decision the user is making. */
export function describePermissionRequest(
  call: PendingToolCall,
  ctx: PermissionContext,
  workspace: string,
): PermissionPresentation {
  const input = isRecord(call.input) ? call.input : {};
  const workspaceName = path.basename(workspace) || workspace;

  if (call.name === 'Bash') {
    return {
      title: 'Run this command?',
      action: 'Moxxy wants to run a shell command.',
      targetLabel: 'Command',
      target: terminalSafeText(stringInput(input, 'command', '(command not provided)'), 240),
      impact: 'It can read or change files and start processes on this computer.',
      sessionLabel: 'allow this exact command for this run',
      sessionScope: { inputKeys: presentKeys(input, ['command', 'cwd']) },
    };
  }

  if (call.name === 'Write' || call.name === 'Edit') {
    const file = stringInput(input, 'file_path', '(file not provided)');
    return {
      title: 'Change this file?',
      action: call.name === 'Write' ? 'Moxxy wants to write a file.' : 'Moxxy wants to edit a file.',
      targetLabel: 'File',
      target: displayPath(file, workspace),
      impact: 'This changes content on disk. You can review the result in git.',
      sessionLabel: 'allow changes to this file for this run',
      sessionScope: { inputKeys: ['file_path'] },
    };
  }

  if (call.name === 'Read' || call.name === 'Glob' || call.name === 'Grep') {
    const key = call.name === 'Read' ? 'file_path' : 'cwd';
    const target = stringInput(input, key, workspace);
    const action =
      call.name === 'Read'
        ? 'read this file'
        : call.name === 'Glob'
          ? 'list files here'
          : 'search files here';
    return {
      title: 'Access outside this workspace?',
      action: `Moxxy wants to ${action}.`,
      targetLabel: 'Location',
      target: displayPath(target, workspace),
      impact: `This can reveal files that are not part of ${workspaceName}.`,
      sessionLabel: 'allow this location for this run',
      sessionScope: { inputKeys: [key] },
    };
  }

  const inputKeys = Object.keys(input).sort();
  return {
    title: 'Allow this action?',
    action: terminalSafeText(ctx.toolDescription ?? `Moxxy wants to use ${call.name}.`, 160),
    targetLabel: 'Action',
    target: terminalSafeText(call.name, 80),
    impact: 'This optional capability needs your approval before it can continue.',
    sessionLabel: 'allow the same action for this run',
    sessionScope: { inputKeys },
  };
}

export interface PermissionDialogProps {
  readonly call: PendingToolCall;
  readonly ctx: PermissionContext;
  readonly workspace: string;
  readonly queueDepth?: number;
  readonly onDecide: (decision: PermissionDecision) => void;
}

export const PermissionDialog: React.FC<PermissionDialogProps> = ({
  call,
  ctx,
  workspace,
  queueDepth = 0,
  onDecide,
}) => {
  const [details, setDetails] = useState(false);
  const presentation = describePermissionRequest(call, ctx, workspace);

  useInput((input, key) => {
    const ch = input.toLowerCase();
    if (ch === 'y' || key.return) onDecide({ mode: 'allow' });
    else if (ch === 'a') {
      onDecide({ mode: 'allow_session', sessionScope: presentation.sessionScope });
    } else if (ch === 'd') setDetails((visible) => !visible);
    else if (ch === 'n' || key.escape) onDecide({ mode: 'deny', reason: 'user declined' });
  });

  const queueNote = queueDepth > 0 ? `${queueDepth} more decision${queueDepth === 1 ? '' : 's'} queued` : undefined;
  return (
    <Modal
      title={presentation.title}
      subtitle={queueNote}
      hints={`Enter allow once · A ${presentation.sessionLabel} · D details · Esc deny`}
    >
      <Text bold>{presentation.action}</Text>
      <Box flexDirection="column" marginTop={1}>
        <Text dimColor>{presentation.targetLabel}</Text>
        <Text>{presentation.target}</Text>
      </Box>
      <Box marginTop={1}>
        <Text color={Colors.busy}>Impact  </Text>
        <Text>{presentation.impact}</Text>
      </Box>
      {details ? (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>Technical details</Text>
          <Text dimColor>Capability: {call.name}</Text>
          <Text dimColor>Input: {previewToolInput(call.input)}</Text>
          {ctx.skillContext ? <Text dimColor>Requested by: {ctx.skillContext}</Text> : null}
        </Box>
      ) : null}
      <Box marginTop={1}>
        <Text>[Enter]</Text>
        <Text dimColor> once  </Text>
        <Text>[A]</Text>
        <Text dimColor> this run  </Text>
        <Text color={Colors.danger}>[Esc]</Text>
        <Text dimColor> deny</Text>
      </Box>
    </Modal>
  );
};

function stringInput(input: Record<string, unknown>, key: string, fallback: string): string {
  return typeof input[key] === 'string' ? input[key] : fallback;
}

function presentKeys(input: Record<string, unknown>, keys: ReadonlyArray<string>): string[] {
  return keys.filter((key) => input[key] !== undefined);
}

function displayPath(candidate: string, workspace: string): string {
  if (!path.isAbsolute(candidate)) return terminalSafeText(candidate, 240);
  const fromWorkspace = path.relative(workspace, candidate);
  if (fromWorkspace === '' || (!fromWorkspace.startsWith(`..${path.sep}`) && fromWorkspace !== '..')) {
    return terminalSafeText(fromWorkspace || '.', 240);
  }
  return terminalSafeText(candidate, 240);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
