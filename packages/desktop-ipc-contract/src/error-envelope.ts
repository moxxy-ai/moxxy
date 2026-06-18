// ---------- Uniform error envelope ----------------------------------------

/**
 * Stable classification for any error a main-process handler surfaces. The
 * renderer branches on `code` instead of string-matching English messages
 * (which drift). `message` is the human-readable detail.
 *
 *   - `invalid-payload` — runtime validation rejected the renderer's input.
 *   - `not-connected`   — no runner/session bound for the target workspace.
 *   - `no-workspace`    — no active workspace and none specified.
 *   - `not-supported`   — the host lacks the OPTIONAL capability behind the
 *                         command (no transcriber, workflows plugin not
 *                         loaded). Clients treat this as "hide/disable the
 *                         affordance", never as a failure to retry.
 *   - `runner-error`    — the runner/handler threw while doing the work.
 *   - `unknown`         — anything not otherwise classified.
 */
export type MoxxyIpcErrorCode =
  | 'invalid-payload'
  | 'not-connected'
  | 'no-workspace'
  | 'not-supported'
  | 'runner-error'
  | 'unknown';

export interface MoxxyIpcError {
  readonly code: MoxxyIpcErrorCode;
  readonly message: string;
}

/** Marker the envelope is wrapped in so the renderer can recover it from the
 *  Electron-prefixed `Error invoking remote method …` string. */
const IPC_ERROR_PREFIX = 'MOXXY_IPC_ERR:';

/** Serialize an envelope into a thrown Error's message (main side). */
export function encodeIpcError(err: MoxxyIpcError): string {
  return IPC_ERROR_PREFIX + JSON.stringify(err);
}

/** Recover an envelope from a rejected invoke()'s message, or null if the
 *  string isn't one of ours (renderer side). Electron prefixes the message,
 *  so we search for the marker rather than expecting it at index 0. */
export function decodeIpcError(message: string): MoxxyIpcError | null {
  const at = message.indexOf(IPC_ERROR_PREFIX);
  if (at < 0) return null;
  try {
    const parsed = JSON.parse(message.slice(at + IPC_ERROR_PREFIX.length)) as MoxxyIpcError;
    if (parsed && typeof parsed.code === 'string' && typeof parsed.message === 'string') {
      return parsed;
    }
  } catch {
    /* trailing text wasn't valid JSON — not our envelope */
  }
  return null;
}
