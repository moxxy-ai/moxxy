/**
 * Composer send orchestration as a focused hook.
 *
 * Owns the three send-side callbacks: `submit` (ship the draft + staged
 * attachments, then clear), `setAutoApprove` (mirror the per-workspace
 * auto-approve flag to the runner driver), and `startGoal` (the one-click
 * goal: switch to goal mode, turn auto-approve ON, submit the objective).
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

/** Drive the runner-side config (mode / auto-approve) and resolve once it has
 *  applied, so a goal's first tool call can't race the approve flip. */
async function applyGoalConfig(workspaceId: string): Promise<void> {
  const a = api();
  // Sequential: set the mode first, THEN auto-approve, so neither RPC can be
  // reordered ahead of the turn we enqueue afterwards.
  await a.invoke('session.setMode', { workspaceId, mode: 'goal' }).catch(() => {});
  await a.invoke('session.setAutoApprove', { workspaceId, enabled: true }).catch(() => {});
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

  // One-click goal: switch to goal mode, turn auto-approve ON, and start
  // working on the typed objective. Mirrors the TUI's `/goal <objective>`
  // (switch mode + yolo + submit). Needs an objective in the draft.
  //
  // The mode + auto-approve RPCs are AWAITED before the turn is enqueued: if
  // the turn were sent before they applied, the goal's first tool call could
  // hit the approval sheet (or run under the wrong mode), breaking the
  // one-click "auto-approve on until done" contract the UI advertises.
  const startGoal = useCallback(
    (objective: string): void => {
      if (!ready) return;
      const trimmed = objective.trim();
      if (!trimmed) return;
      // Optimistically mirror the auto-approve flag to the store so the UI
      // reflects it immediately; the awaited RPC below is what actually gates.
      chatStore.setAutoApprove(workspaceId, true);
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
