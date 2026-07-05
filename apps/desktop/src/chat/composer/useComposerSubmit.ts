/**
 * Composer send orchestration as a focused hook.
 *
 * Owns the three send-side callbacks: `submit` (ship the draft + staged
 * attachments, then clear), `setAutoApprove` (mirror the per-workspace
 * auto-approve flag to the runner driver), and `startGoal` (the one-click
 * goal: switch to goal mode and submit the objective — goal mode auto-approves
 * its own tool calls internally and hands back to the previous mode when the
 * objective concludes, so no session-wide auto-approve flip is needed).
 *
 * Extracted verbatim from `Composer.tsx`; behavior is unchanged. The composer
 * still owns the draft/attachment STATE and passes the values + clear callbacks
 * in, so this hook stays a thin orchestration layer over `onSend` + the IPC.
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
  readonly startGoal: (objective: string) => void;
}

/** Switch the runner to goal mode and resolve once it has applied, so the
 *  objective turn can't run under the previous mode. No auto-approve flip:
 *  goal mode auto-approves its own tool calls via a run-scoped resolver, so a
 *  session-wide flag (which would outlive the run) is redundant — and it made
 *  the session permanently promptless after the goal finished. */
async function applyGoalConfig(workspaceId: string): Promise<void> {
  await api()
    .invoke('session.setMode', { workspaceId, mode: 'goal' })
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

  // One-click goal: switch to goal mode and start working on the typed
  // objective. Mirrors the TUI's `/goal <objective>`. Needs an objective in
  // the draft.
  //
  // The mode RPC is AWAITED before the turn is enqueued: if the turn were
  // sent before it applied, the objective would run under the wrong mode.
  // Tool approval needs no flip here — goal mode auto-approves internally
  // for the duration of the run only.
  const startGoal = useCallback(
    (objective: string): void => {
      if (!ready) return;
      const trimmed = objective.trim();
      if (!trimmed) return;
      // Close the modal + clear the composer up front (the input is consumed).
      clearDraft();
      clearAttachments();
      closeGoal();
      void applyGoalConfig(workspaceId).then(() => {
        // Refresh the Mode chip so it reflects the switch.
        window.dispatchEvent(new CustomEvent(SESSION_INFO_REFRESH_EVENT));
        onSend(trimmed, attachments.length > 0 ? attachments : undefined);
      });
    },
    [ready, attachments, workspaceId, onSend, clearDraft, clearAttachments, closeGoal],
  );

  return { submit, setAutoApprove, startGoal };
}
