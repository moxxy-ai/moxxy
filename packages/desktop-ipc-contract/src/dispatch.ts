/**
 * The single, transport-neutral choke point every renderer→main (or
 * client→host) command flows through. It does three things, in order, that used
 * to be welded onto `ipcMain.handle` in the desktop host:
 *
 *   1. Runtime-validate the payload ({@link validateIpcInput}) before any
 *      handler touches the filesystem / a child process / the vault.
 *   2. Run the handler.
 *   3. Classify any failure into a stable {@link MoxxyIpcErrorCode}.
 *
 * It returns a structured {@link IpcDispatchResult} instead of throwing the
 * Electron-specific string envelope — each transport (Electron `CommandBus`,
 * WebSocket `CommandBus`) serializes that result in its own native error shape.
 * Keeping this here, in the leaf contract package, is what lets the WebSocket
 * server reuse the exact same validate-and-classify policy without depending on
 * `@moxxy/desktop-host` (which pulls in Electron).
 */

import { validateIpcInput } from './validation.js';
import type {
  IpcCommandName,
  IpcCommands,
  MoxxyIpcErrorCode,
} from './index.js';
import type { IpcDispatchResult } from './bus.js';

/**
 * A handler error carrying a stable {@link MoxxyIpcErrorCode}. The shared host
 * guards (`mustRemote`, `resolveCtx`, …) throw these so {@link dispatch} can
 * read `.code`; anything else a handler throws is classified `runner-error`.
 *
 * Lives here (not in the host) so both the dispatch core and the host guards
 * reference one class. The host re-exports it from `ipc/shared` for back-compat.
 */
export class IpcError extends Error {
  constructor(
    readonly code: MoxxyIpcErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'IpcError';
  }
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Validate → run → classify one command. Never throws: a bad payload, a thrown
 * {@link IpcError}, or any other handler failure all come back as
 * `{ ok: false, error }`. A successful `undefined` is normalized to `null` so
 * it round-trips identically over Electron IPC and JSON-RPC (the latter has no
 * `undefined`).
 */
export async function dispatch<K extends IpcCommandName>(
  channel: K,
  args: Parameters<IpcCommands[K]>,
  fn: (...args: Parameters<IpcCommands[K]>) => Promise<Awaited<ReturnType<IpcCommands[K]>>>,
): Promise<IpcDispatchResult> {
  try {
    validateIpcInput(channel, args[0]);
  } catch (e) {
    return { ok: false, error: { code: 'invalid-payload', message: messageOf(e) } };
  }
  try {
    const value = await fn(...args);
    return { ok: true, value: value === undefined ? null : value };
  } catch (e) {
    const code: MoxxyIpcErrorCode = e instanceof IpcError ? e.code : 'runner-error';
    return { ok: false, error: { code, message: messageOf(e) } };
  }
}
