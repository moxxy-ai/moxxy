import { useCallback, useSyncExternalStore } from 'react';
import { api, chatStore } from '@moxxy/client-core';
import type { BrowserControlState } from '@moxxy/desktop-ipc-contract';

/** What the pane offers: the agent is driving, the person has it, or nobody is working there. */
export type BrowserControlMode = 'agent' | 'user' | null;

/**
 * The pane shows its controls while the turn that last used the browser is
 * running — and only then: a finished turn has nothing left to stop.
 */
export function browserControlMode(control: BrowserControlState, activeTurnId: string | null): BrowserControlMode {
  if (activeTurnId === null || control.turnId !== activeTurnId) return null;
  return control.driver;
}

/**
 * Take over, hand back, or stop the agent working in the browser.
 *
 * Who drives lives in main (one state, every surface): these only ask main to
 * change it. Stop also ends the running turn, the same as interrupting it from
 * the chat — the browser is taken back first, so nothing more lands on the page
 * while the turn winds down.
 */
export function useBrowserControl(workspaceId: string | null, control: BrowserControlState) {
  const activeTurnId = useSyncExternalStore(chatStore.subscribe, () =>
    workspaceId ? chatStore.getChat(workspaceId).activeTurnId : null,
  );

  const send = useCallback(async (command: 'takeover' | 'resume') => {
    await api().invoke('browser.control', { command }).catch(() => {});
  }, []);

  const takeOver = useCallback(() => send('takeover'), [send]);
  const resume = useCallback(() => send('resume'), [send]);
  const stop = useCallback(async () => {
    await send('takeover');
    if (!workspaceId || activeTurnId === null) return;
    await api().invoke('session.abortTurn', { workspaceId, turnId: activeTurnId }).catch(() => {});
  }, [send, workspaceId, activeTurnId]);

  return { mode: browserControlMode(control, activeTurnId), takeOver, resume, stop };
}
