/**
 * The transport-neutral seam for the IPC surface.
 *
 * Historically the renderer→main commands were wired straight onto Electron's
 * `ipcMain.handle` and the main→renderer events onto `BrowserWindow.webContents
 * .send`. That welded the contract to Electron. These two tiny interfaces lift
 * the welding out: a {@link CommandBus} registers request handlers and an
 * {@link EventSink} broadcasts events — and *what* sits behind them (Electron
 * IPC today, or another transport serving the same contract) is a swappable
 * detail. The per-domain handler bodies register against a
 * `CommandBus` and never see the transport.
 *
 * The matching client primitive is {@link MoxxyApi} (`invoke` / `subscribe`)
 * already declared in `./index`. A bus is its server-side mirror.
 */

import type {
  IpcCommandName,
  IpcCommands,
  IpcEvents,
  MoxxyIpcError,
} from './index.js';

/**
 * Registers request handlers for renderer→main commands. The implementation
 * wraps `ipcMain.handle` (Electron); another transport would wrap its own
 * connection. The signature mirrors the old `handle()` choke
 * point exactly so the per-domain registrars port over unchanged.
 */
export interface CommandBus {
  handle<K extends IpcCommandName>(
    channel: K,
    fn: (
      ...args: Parameters<IpcCommands[K]>
    ) => Promise<Awaited<ReturnType<IpcCommands[K]>>>,
  ): void;
}

/**
 * Pushes a main→renderer event to every surface this sink fronts (all Electron
 * windows). Events already carry their
 * `workspaceId`, so a sink fans the full tagged stream and each client routes
 * by tag — exactly as the desktop renderer already does.
 */
export interface EventSink {
  broadcast<K extends keyof IpcEvents>(channel: K, payload: IpcEvents[K]): void;
}

/**
 * The transport-neutral result of running one command through the shared
 * {@link dispatch} core: either a value to return, or a classified
 * {@link MoxxyIpcError}. Each bus serializes this in its own native error shape
 * — the Electron bus re-encodes it into the string envelope the renderer
 * already decodes.
 */
export type IpcDispatchResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly error: MoxxyIpcError };
