/**
 * Single helper for every main→renderer event push.
 *
 * Two jobs, both of which were previously hand-rolled (and sometimes wrong) at
 * each call site:
 *
 *   1. Type the channel against {@link IpcEvents}. A renamed event then surfaces
 *      as a compile error instead of a string literal that silently stops
 *      firing (the `installer.ts` progress channel was a bare literal).
 *
 *   2. Guard BOTH the window and its `webContents` against being destroyed. A
 *      window can be destroyed while its `webContents` lingers in a destroyed
 *      state; calling `.send()` on that throws and can crash the main process
 *      on a send that races a window reload / teardown.
 */

import type { BrowserWindow } from 'electron';
import type { IpcEvents } from '@moxxy/desktop-ipc-contract';

export function sendEvent<K extends keyof IpcEvents>(
  window: BrowserWindow,
  channel: K,
  payload: IpcEvents[K],
): void {
  if (window.isDestroyed() || window.webContents.isDestroyed()) return;
  try {
    window.webContents.send(channel, payload);
  } catch {
    // Renderer can vanish between the guard and the send; nothing to do.
  }
}
