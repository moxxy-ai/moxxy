/**
 * Composer send orchestration as a focused hook.
 *
 * Owns the send-side callbacks: `submit` (ship the draft + staged
 * attachments, then clear), `setAutoApprove` (mirror the per-workspace
 * auto-approve flag to the runner driver), `startIn` (switch the mode, then
 * submit a prompt in it) and `startGoal` (the one-click goal: `startIn` goal
 * mode — it auto-approves its own tool calls internally and hands back to the
 * previous mode when the objective concludes, so no session-wide auto-approve
 * flip is needed).
 *
 * The composer still owns the draft/attachment STATE and passes the values +
 * clear callbacks in, so this hook stays a thin orchestration layer over
 * `onSend` + the IPC.
 */
import { useCallback } from 'react';
import { api, chatStore } from '@moxxy/client-core';
import { SESSION_INFO_REFRESH_EVENT } from '../agent-picker/types';
import type { ComposerAttachment } from './useComposerAttachments';

export interface UseComposerSubmitArgs {
  readonly ready: boolean;
  readonly canSubmit: boolean;
  readonly draft: string;
  readonly attachments: ReadonlyArray<ComposerAttachment>;
  readonly workspaceId: string;
  readonly onSend: (
    prompt: string,
    attachments?: ReadonlyArray<ComposerAttachment>,
  ) => void;
  /** Clear the draft after a successful send. */
  readonly clearDraft: () => void;
  /** Drop the staged attachments after a successful send. */
  readonly clearAttachments: () => void;
  /** Close the goal modal once a goal run starts. */
  readonly closeGoal: () => void;
}

export interface ComposerSubmit {
  readonly submit: () => void;
  readonly setAutoApprove: (enabled: boolean) => void;
  /** Switch to `mode`, then send `prompt` in it. */
  readonly startIn: (mode: string, prompt: string) => void;
  readonly startGoal: (objective: string) => void;
}

/** Switch the runner's mode and resolve once it has applied, so the turn that
 *  follows can't run under the previous one. Goal mode needs no auto-approve
 *  flip: it auto-approves its own tool calls via a run-scoped resolver, so a
 *  session-wide flag (which would outlive the run) is redundant — and it made
 *  the session permanently promptless after the goal finished. */
async function applyMode(workspaceId: string, mode: string): Promise<void> {
  await api()
    .invoke('session.setMode', { workspaceId, mode })
    .catch(() => {});
}

export function useComposerSubmit({
  ready,
  canSubmit,
  draft,
  attachments,
  workspaceId,
  onSend,
  clearDraft,
  clearAttachments,
  closeGoal,
}: UseComposerSubmitArgs): ComposerSubmit {
  const submit = useCallback(() => {
    if (!canSubmit) return;
    onSend(draft, attachments.length > 0 ? attachments : undefined);
    clearDraft();
    clearAttachments();
  }, [canSubmit, draft, attachments, onSend, clearDraft, clearAttachments]);

  const setAutoApprove = useCallback(
    (enabled: boolean): void => {
      chatStore.setAutoApprove(workspaceId, enabled);
      void api()
        .invoke('session.setAutoApprove', { workspaceId, enabled })
        .catch(() => {});
    },
    [workspaceId],
  );

  // Switch the mode and start on the typed prompt in it: the one-click goal
  // (the TUI's `/goal <objective>`) and a slash line such as `/plan <prompt>`.
  //
  // The mode RPC is AWAITED before the turn is enqueued: if the turn were
  // sent before it applied, the prompt would run under the wrong mode.
  const startIn = useCallback(
    (mode: string, prompt: string): void => {
      if (!ready) return;
      const trimmed = prompt.trim();
      if (!trimmed) return;
      // Clear the composer up front (the input is consumed).
      clearDraft();
      clearAttachments();
      closeGoal();
      void applyMode(workspaceId, mode).then(() => {
        // Refresh the Mode chip so it reflects the switch.
        window.dispatchEvent(new CustomEvent(SESSION_INFO_REFRESH_EVENT));
        onSend(trimmed, attachments.length > 0 ? attachments : undefined);
      });
    },
    [ready, attachments, workspaceId, onSend, clearDraft, clearAttachments, closeGoal],
  );

  // Tool approval needs no flip here — goal mode auto-approves internally
  // for the duration of the run only.
  const startGoal = useCallback((objective: string): void => startIn('goal', objective), [startIn]);

  return { submit, setAutoApprove, startIn, startGoal };
}
