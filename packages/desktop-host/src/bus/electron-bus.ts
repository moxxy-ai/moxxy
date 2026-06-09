/**
 * The Electron implementation of {@link CommandBus}.
 *
 * It reproduces, byte-for-byte, the wire behavior the renderer already depends
 * on: `ipcMain.handle` per command, and — on failure — a thrown `Error` whose
 * message is the {@link encodeIpcError} string envelope the preload/renderer
 * recover with `decodeIpcError`. The only change from the old `handle()` choke
 * point is that the validate→run→classify policy now lives in the shared
 * {@link dispatch} core (so the WebSocket bus reuses the same policy); this
 * class just re-encodes the structured result into the Electron-native shape.
 *
 * Events are NOT routed through this bus — the desktop keeps delivering them
 * straight to its `BrowserWindow`s via `sendEvent` (see `event-bus.ts` for why).
 */

import { ipcMain } from 'electron';

import type {
  IpcCommandName,
  IpcCommands,
} from '@moxxy/desktop-ipc-contract';
import { encodeIpcError } from '@moxxy/desktop-ipc-contract';
import { dispatch } from '@moxxy/desktop-ipc-contract/dispatch';
import type { CommandBus } from '@moxxy/desktop-ipc-contract/bus';

export class ElectronCommandBus implements CommandBus {
  handle<K extends IpcCommandName>(
    channel: K,
    fn: (
      ...args: Parameters<IpcCommands[K]>
    ) => Promise<Awaited<ReturnType<IpcCommands[K]>>>,
  ): void {
    ipcMain.handle(channel, async (_evt, ...args) => {
      const result = await dispatch(channel, args as Parameters<IpcCommands[K]>, fn);
      if (result.ok) return result.value;
      // Identical to the pre-refactor wire shape: a thrown Error whose message
      // carries the coded envelope the renderer decodes.
      throw new Error(encodeIpcError(result.error));
    });
  }
}
