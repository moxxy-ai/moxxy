/**
 * Over-the-air (OTA) update state machine.
 *
 * This is the platform-agnostic brain of the app's EAS Update integration. It
 * holds NO React and NO `expo-updates` import so it stays trivially unit
 * testable; `useOtaUpdates` is the thin adapter that turns the actions below
 * into real `expo-updates` calls (see `src/hooks/useOtaUpdates.ts`).
 *
 * Lifecycle, driven entirely by `reduceOta`:
 *
 *   app becomes active ─▶ check ─▶ (available) ─▶ download ─▶ ready(pending)
 *                                    │                            │
 *                            (up to date) ─▶ idle                 │
 *                                                                 ▼
 *   app becomes active again ────────────────────────────────▶ reload
 *
 * A downloaded update is deliberately applied on the *next* activation rather
 * than mid-session, so a fresh JS bundle boots in without yanking the screen
 * out from under whoever is using the app right now. (`expo-updates` also
 * applies it on the next cold launch, so nothing is ever lost.)
 */

export type OtaStatus =
  /** nothing in flight, bundle is current (or not yet checked) */
  | 'idle'
  /** asking the EAS Update server whether a newer bundle exists */
  | 'checking'
  /** a newer bundle exists and is being downloaded */
  | 'downloading'
  /** a bundle has been downloaded and is waiting to be applied on next activation */
  | 'ready'
  /** the last check or download failed; will retry on the next activation */
  | 'error';

export interface OtaState {
  status: OtaStatus;
  /** true once an update has downloaded and is waiting for a reload */
  pending: boolean;
}

/** Side effect the host (the hook) should perform after a transition. */
export type OtaAction = 'none' | 'check' | 'download' | 'reload';

export type OtaEvent =
  /** the app came to the foreground (also fired once on mount) */
  | { type: 'app-active' }
  /** result of `checkForUpdateAsync` */
  | { type: 'checked'; available: boolean }
  /** result of `fetchUpdateAsync` */
  | { type: 'downloaded'; ok: boolean }
  /** any `expo-updates` call threw */
  | { type: 'failed' };

export interface OtaTransition {
  state: OtaState;
  action: OtaAction;
}

export const initialOtaState: OtaState = { status: 'idle', pending: false };

/** True while an async check/download chain is in flight and shouldn't be re-entered. */
export function otaBusy(state: OtaState): boolean {
  return state.status === 'checking' || state.status === 'downloading';
}

/**
 * Pure transition function: given the current state and an event, return the
 * next state plus the single side effect the host should run.
 */
export function reduceOta(state: OtaState, event: OtaEvent): OtaTransition {
  switch (event.type) {
    case 'app-active': {
      // A previously downloaded update is applied now, on the fresh activation.
      if (state.pending) {
        return { state: { status: 'ready', pending: true }, action: 'reload' };
      }
      // Don't stack a second check/download on top of one already running.
      if (otaBusy(state)) {
        return { state, action: 'none' };
      }
      return { state: { status: 'checking', pending: false }, action: 'check' };
    }
    case 'checked': {
      if (event.available) {
        return { state: { status: 'downloading', pending: false }, action: 'download' };
      }
      return { state: { status: 'idle', pending: false }, action: 'none' };
    }
    case 'downloaded': {
      if (event.ok) {
        // Hold the update; it applies on the next 'app-active'.
        return { state: { status: 'ready', pending: true }, action: 'none' };
      }
      return { state: { status: 'error', pending: false }, action: 'none' };
    }
    case 'failed': {
      return { state: { status: 'error', pending: false }, action: 'none' };
    }
  }
}

export interface OtaEnv {
  /** `Updates.isEnabled` — false in Expo Go and when no update URL is configured */
  isEnabled: boolean;
  /** `__DEV__` — never OTA in development; Metro owns the bundle there */
  isDev: boolean;
  /** running under the web platform, where `expo-updates` is a no-op */
  isWeb: boolean;
}

/**
 * Whether the OTA machinery should run at all. Keeping this pure lets the hook
 * stay a no-op in Expo Go / dev / web without duplicating the condition.
 */
export function otaUpdatesActive(env: OtaEnv): boolean {
  return env.isEnabled && !env.isDev && !env.isWeb;
}

/** Human-readable label for the current status (for an optional UI surface). */
export function otaStatusLabel(state: OtaState): string {
  switch (state.status) {
    case 'checking':
      return 'Checking for updates…';
    case 'downloading':
      return 'Downloading update…';
    case 'ready':
      return 'Update ready — applying on next open';
    case 'error':
      return 'Update check failed';
    case 'idle':
      return 'Up to date';
  }
}
