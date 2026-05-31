import { decodeIpcError, type MoxxyIpcError, type MoxxyIpcErrorCode } from '@moxxy/desktop-ipc-contract';

/**
 * Decode a rejected `window.moxxy.invoke()` failure into the uniform
 * {@link MoxxyIpcError} envelope the main process encodes at its handler choke
 * point. Falls back to `{ code: 'unknown', message }` for anything that isn't
 * one of ours (preload missing, a raw throw, a non-Error value), so callers can
 * always branch on `code` without a null check.
 */
export function decodeError(e: unknown): MoxxyIpcError {
  const raw = e instanceof Error ? e.message : String(e);
  return decodeIpcError(raw) ?? { code: 'unknown', message: raw };
}

/** Normalize a thrown value to a human-readable string. Unwraps the IPC error
 *  envelope (and Electron's `Error invoking remote method …` prefix) so the UI
 *  shows the clean message rather than the wire encoding. Replaces the
 *  `e instanceof Error ? e.message : String(e)` incantation that was scattered
 *  across the renderer's catch blocks. */
export function toErrorMessage(e: unknown): string {
  return decodeError(e).message;
}

/** True when the failure carries the given IPC error code. Lets callers branch
 *  on a stable code (e.g. ignore `not-connected` noise during reconnect)
 *  instead of string-matching English messages. */
export function isIpcErrorCode(e: unknown, code: MoxxyIpcErrorCode): boolean {
  return decodeError(e).code === code;
}
