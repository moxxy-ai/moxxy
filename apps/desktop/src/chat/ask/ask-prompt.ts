import { useCallback, useEffect, useMemo, useState } from 'react';
import { askStore } from '@moxxy/client-core';
import type { ApprovalOption, ApprovalRequest, AskRequest, WorkflowAsk } from '@moxxy/desktop-ipc-contract';
import { toolCallText } from './tool-call-text';

/**
 * One reading of a blocking question for every surface that shows it.
 *
 * The runner waits on the person in three ways: a tool asks leave to run, a
 * mode asks which way to go on, a workflow wants a reply. This turns each into
 * the same shape (a title, what was written, the answers, the safe way out),
 * and both the desktop's card and the focus window's card are drawn from it.
 */

export type AskTone = 'primary' | 'neutral' | 'danger';

export interface AskAction {
  readonly id: string;
  readonly label: string;
  readonly tone: AskTone;
  readonly disabled?: boolean;
  readonly title?: string;
  readonly onClick: () => void;
}

export interface AskTextInput {
  readonly label: string;
  readonly value: string;
  readonly placeholder: string;
  readonly onChange: (value: string) => void;
  /** ⌘↵ / Ctrl+↵ in the field, where a reply is the only answer. */
  readonly onSubmit?: () => void;
}

/** Where focus rests when the question appears: an answer, the field, or the first control. */
export const ASK_FOCUS_TEXT = 'text';

export interface AskPrompt {
  readonly requestId: string;
  /** Asking leave to act is a caution; asking which way to go on is not. */
  readonly kind: 'caution' | 'accent';
  readonly icon: 'wrench' | 'spark';
  readonly title: string;
  /** The accessible name. It names the tool first, which is what is needed first. */
  readonly label: string;
  /** One plain line: which step is waiting. */
  readonly lead?: string;
  /** What the agent or the tool wrote to explain the question, as markdown. */
  readonly prose?: string;
  /** The tool's call, whole and verbatim. */
  readonly command?: string;
  readonly textInput?: AskTextInput;
  readonly actions: ReadonlyArray<AskAction>;
  readonly focus: string | null;
  /** The keyboard contract, stated only where it is wired. */
  readonly keys?: string;
  readonly escape?: () => void;
}

export function useAskPrompt(ask: AskRequest | null): AskPrompt | null {
  const [textOptionId, setTextOptionId] = useState<string | null>(null);
  const [text, setText] = useState('');
  const requestId = ask ? ask.requestId : null;

  useEffect(() => {
    setTextOptionId(null);
    setText('');
  }, [requestId]);

  const leaveText = useCallback(() => {
    setTextOptionId(null);
    setText('');
  }, []);

  return useMemo(() => {
    if (!ask) return null;
    if (ask.kind === 'approval' && ask.approval) {
      return approvalPrompt(ask.requestId, ask.approval, { textOptionId, text, setTextOptionId, setText, leaveText });
    }
    if (ask.kind === 'workflow' && ask.workflow) {
      return workflowPrompt(ask.requestId, ask.workflow, text, setText);
    }
    return permissionPrompt(ask);
  }, [ask, textOptionId, text, leaveText]);
}

function permissionPrompt(ask: AskRequest): AskPrompt {
  const tool = ask.tool;
  const name = tool ? tool.name : null;
  const command = tool ? toolCallText(tool.input) : '';
  const decide = (mode: 'deny' | 'allow_session' | 'allow_always') => (): void =>
    askStore.respond(ask.requestId, { mode });
  return {
    requestId: ask.requestId,
    kind: 'caution',
    icon: 'wrench',
    title: `${name ?? 'A tool'} needs your approval`,
    label: `approval required · ${name ?? 'tool'}`,
    // A tool describes itself in markdown, like anything else the agent wrote.
    ...(tool && tool.description ? { prose: tool.description } : {}),
    ...(command ? { command } : {}),
    // The narrow answer leads. Enter approves nothing: focus rests on Deny.
    actions: [
      { id: 'allow', label: 'Allow once', tone: 'primary', onClick: decide('allow_session') },
      { id: 'always', label: `Always allow ${name ?? 'this'}`, tone: 'neutral', onClick: decide('allow_always') },
      { id: 'deny', label: 'Deny', tone: 'danger', onClick: decide('deny') },
    ],
    focus: 'deny',
    keys: 'Esc denies',
    escape: decide('deny'),
  };
}

interface TextStep {
  readonly textOptionId: string | null;
  readonly text: string;
  readonly setTextOptionId: (id: string | null) => void;
  readonly setText: (value: string) => void;
  readonly leaveText: () => void;
}

function approvalPrompt(requestId: string, approval: ApprovalRequest, step: TextStep): AskPrompt {
  const base = {
    requestId,
    kind: 'accent',
    icon: 'spark',
    title: approval.title,
    label: approval.title,
    ...(approval.body.trim() ? { prose: approval.body.trim() } : {}),
  } as const;
  const textOption = step.textOptionId
    ? approval.options.find((option) => option.id === step.textOptionId)
    : undefined;

  if (textOption) {
    const words = step.text.trim();
    return {
      ...base,
      textInput: {
        label: textOption.label,
        value: step.text,
        placeholder: textOption.textPrompt ?? 'Add details…',
        onChange: step.setText,
      },
      actions: [
        { id: 'back', label: 'Back', tone: 'neutral', onClick: step.leaveText },
        {
          id: textOption.id,
          label: textOption.label,
          tone: textOption.danger ? 'danger' : 'primary',
          disabled: words.length === 0,
          onClick: () => askStore.respond(requestId, { optionId: textOption.id, text: words }),
        },
      ],
      focus: ASK_FOCUS_TEXT,
      // Escape backs out to the answers; it never sends half-written words.
      escape: step.leaveText,
    };
  }

  const pick = (option: ApprovalOption) => (): void => {
    if (option.requestsText) step.setTextOptionId(option.id);
    else askStore.respond(requestId, { optionId: option.id });
  };
  const fallback = approval.options.find((option) => option.id === approval.defaultOptionId);
  // The default is rested on, and taken by Escape, only when it throws nothing away.
  const safe = fallback && !fallback.danger ? fallback : undefined;
  return {
    ...base,
    actions: approval.options.map((option) => ({
      id: option.id,
      label: option.label,
      tone: option.danger ? 'danger' : option.id === approval.defaultOptionId ? 'primary' : 'neutral',
      ...(option.description ? { title: option.description } : {}),
      onClick: pick(option),
    })),
    focus: safe ? safe.id : null,
    ...(safe && !safe.requestsText ? { escape: pick(safe) } : {}),
  };
}

function workflowPrompt(
  requestId: string,
  workflow: WorkflowAsk,
  text: string,
  setText: (value: string) => void,
): AskPrompt {
  const reply = text.trim();
  const send = (): void => {
    if (reply) askStore.respond(requestId, { text: reply });
  };
  const lead = [workflow.label, workflow.stepId].filter(Boolean).join(' · ');
  const title = `${workflow.workflow} is waiting`;
  return {
    requestId,
    kind: 'caution',
    icon: 'spark',
    title,
    label: title,
    ...(lead ? { lead } : {}),
    ...(workflow.prompt.trim() ? { prose: workflow.prompt.trim() } : {}),
    textInput: {
      label: 'Workflow reply',
      value: text,
      placeholder: 'Type your reply…',
      onChange: setText,
      onSubmit: send,
    },
    actions: [{ id: 'send', label: 'Send reply', tone: 'primary', disabled: reply.length === 0, onClick: send }],
    focus: ASK_FOCUS_TEXT,
  };
}
