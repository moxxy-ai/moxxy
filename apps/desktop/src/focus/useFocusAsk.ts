import { useEffect, useMemo, useState } from 'react';
import { assertDefined } from '@/lib/assert';
import { oneLine, summarizeArgs } from '@moxxy/chat-model';
import { askStore, useActiveAsk } from '@moxxy/client-core';
import type { ApprovalOption, AskRequest } from '@moxxy/desktop-ipc-contract';

export type FocusAskTone = 'danger' | 'neutral' | 'primary';

export interface FocusAskAction {
  readonly id: string;
  readonly label: string;
  readonly tone: FocusAskTone;
  readonly disabled?: boolean;
  readonly title?: string;
  readonly onClick: () => void;
}

export interface FocusAskTextInput {
  readonly label: string;
  readonly value: string;
  readonly placeholder: string;
  readonly onChange: (value: string) => void;
}

export interface FocusAskPrompt {
  readonly requestId: string;
  readonly kicker: string;
  readonly title: string;
  readonly body: string;
  readonly detail?: string;
  readonly textInput?: FocusAskTextInput;
  readonly actions: ReadonlyArray<FocusAskAction>;
}

export function useFocusAsk(workspaceId: string | null): FocusAskPrompt | null {
  const ask = useActiveAsk(workspaceId);
  const [textOptionId, setTextOptionId] = useState<string | null>(null);
  const [text, setText] = useState('');

  useEffect(() => {
    setTextOptionId(null);
    setText('');
  }, [ask?.requestId]);

  return useMemo(() => {
    if (!ask) return null;
    if (ask.kind === 'approval' && ask.approval) {
      return buildApprovalPrompt(ask, textOptionId, text, setTextOptionId, setText);
    }
    if (ask.kind === 'workflow' && ask.workflow) {
      return buildWorkflowPrompt(ask, text, setText);
    }
    return buildPermissionPrompt(ask);
  }, [ask, textOptionId, text]);
}

function buildPermissionPrompt(ask: AskRequest): FocusAskPrompt {
  const tool = ask.tool;
  const toolName = tool?.name ?? 'tool';
  const summary = tool ? oneLine(summarizeArgs(tool.input)) : '';
  const body = tool?.description
    ? `Agent wants to run ${toolName}: ${tool.description}`
    : `Agent wants to run ${toolName}.`;

  return {
    requestId: ask.requestId,
    kicker: 'Permission',
    title: 'Permission required',
    body,
    ...(summary ? { detail: summary } : {}),
    actions: [
      {
        id: 'deny',
        label: 'Deny',
        tone: 'danger',
        onClick: () => askStore.respond(ask.requestId, { mode: 'deny' }),
      },
      {
        id: 'allow',
        label: 'Allow',
        tone: 'neutral',
        onClick: () => askStore.respond(ask.requestId, { mode: 'allow_session' }),
      },
      {
        id: 'always',
        label: 'Always allow',
        tone: 'primary',
        onClick: () => askStore.respond(ask.requestId, { mode: 'allow_always' }),
      },
    ],
  };
}

function buildApprovalPrompt(
  ask: AskRequest,
  textOptionId: string | null,
  text: string,
  setTextOptionId: (id: string | null) => void,
  setText: (value: string) => void,
): FocusAskPrompt {
  const approval = ask.approval;
  assertDefined(approval, 'buildApprovalPrompt is only called for an approval ask');
  const textOption = textOptionId
    ? approval.options.find((option) => option.id === textOptionId) ?? null
    : null;

  if (textOption) {
    return {
      requestId: ask.requestId,
      kicker: 'Approval',
      title: approval.title,
      body: textOption.textPrompt ?? textOption.description ?? approval.body,
      textInput: {
        label: 'Approval reply',
        value: text,
        placeholder: textOption.textPrompt ?? 'Add details...',
        onChange: setText,
      },
      actions: [
        {
          id: 'back',
          label: 'Back',
          tone: 'neutral',
          onClick: () => {
            setTextOptionId(null);
            setText('');
          },
        },
        {
          id: textOption.id,
          label: textOption.label,
          tone: textOption.danger ? 'danger' : 'primary',
          disabled: text.trim().length === 0,
          onClick: () =>
            askStore.respond(ask.requestId, {
              optionId: textOption.id,
              text: text.trim(),
            }),
        },
      ],
    };
  }

  return {
    requestId: ask.requestId,
    kicker: 'Approval',
    title: approval.title,
    ...(approval.body.trim() ? { body: approval.body.trim() } : { body: 'Choose how Moxxy should continue.' }),
    actions: approval.options.map((option) => approvalAction(ask.requestId, option, approval.defaultOptionId, setTextOptionId)),
  };
}

function approvalAction(
  requestId: string,
  option: ApprovalOption,
  defaultOptionId: string | undefined,
  setTextOptionId: (id: string | null) => void,
): FocusAskAction {
  return {
    id: option.id,
    label: option.label,
    tone: option.danger ? 'danger' : option.id === defaultOptionId ? 'primary' : 'neutral',
    title: option.description,
    onClick: () => {
      if (option.requestsText) {
        setTextOptionId(option.id);
        return;
      }
      askStore.respond(requestId, { optionId: option.id });
    },
  };
}

function buildWorkflowPrompt(
  ask: AskRequest,
  text: string,
  setText: (value: string) => void,
): FocusAskPrompt {
  const workflow = ask.workflow;
  assertDefined(workflow, 'buildWorkflowPrompt is only called for a workflow ask');
  const body = [workflow.label, workflow.stepId].filter(Boolean).join(' · ');

  return {
    requestId: ask.requestId,
    kicker: 'Workflow',
    title: `${workflow.workflow} is waiting`,
    body: body || 'Workflow input required.',
    ...(workflow.prompt.trim() ? { detail: workflow.prompt.trim() } : {}),
    textInput: {
      label: 'Workflow reply',
      value: text,
      placeholder: 'Type your reply...',
      onChange: setText,
    },
    actions: [
      {
        id: 'send',
        label: 'Send reply',
        tone: 'primary',
        disabled: text.trim().length === 0,
        onClick: () => askStore.respond(ask.requestId, { text: text.trim() }),
      },
    ],
  };
}
