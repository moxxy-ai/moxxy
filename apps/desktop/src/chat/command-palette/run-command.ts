/**
 * Runs one of the run's actions and puts what it answers in the transcript, as
 * a dismissible `action_result` block. Shared by the palette and the
 * composer's slash menu, so an action behaves the same wherever it is picked.
 */

import { api, chatStore, toErrorMessage } from '@moxxy/client-core';
import type { CommandInfo } from './types';

export async function runSessionCommand(
  workspaceId: string,
  command: CommandInfo,
  argString: string,
): Promise<void> {
  try {
    const result = await api().invoke('session.runCommand', {
      workspaceId,
      name: command.name,
      args: argString,
    });
    // Session-action directives are side-effect-only. Wipe the transcript
    // BEFORE dispatching the notice card below, otherwise it would land in
    // the cleared transcript and immediately disappear.
    if (result.kind === 'session-action' && result.action === 'clear') {
      chatStore.clear(workspaceId);
    } else if (result.kind === 'session-action' && result.action === 'new') {
      // `/new`: clear the transcript AND reset the runner to a fresh, empty
      // session — dropping the model's context and the persisted history so
      // it doesn't resurrect on the next launch. Without the runner reset,
      // clearing only the renderer would leave the model still primed with
      // the old conversation (and a restart would replay it back).
      chatStore.clear(workspaceId);
      await api().invoke('session.newSession', { workspaceId });
    }
    // Don't render an action_result block for pure side-effects /
    // noops; the empty header bar that we used to leave in the
    // chat after a noop command was confusing.
    const text =
      result.kind === 'text'
        ? result.text ?? ''
        : result.kind === 'error'
          ? result.message ?? 'command failed'
          : result.kind === 'session-action'
            ? result.notice ?? ''
            : '';
    const isSilent =
      result.kind === 'noop' ||
      (result.kind === 'session-action' && !text.trim() && !result.notice);
    if (isSilent) return;
    const tone =
      result.kind === 'error' ? 'error' : result.kind === 'session-action' ? 'notice' : 'info';
    chatStore.dispatch(workspaceId, {
      type: 'action_result',
      commandName: command.name,
      argsLine: argString,
      tone,
      text,
    });
  } catch (e) {
    chatStore.dispatch(workspaceId, {
      type: 'action_result',
      commandName: command.name,
      argsLine: argString,
      tone: 'error',
      text: toErrorMessage(e),
    });
  }
}
