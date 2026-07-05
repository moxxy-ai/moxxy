import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import * as Updates from 'expo-updates';

import {
  initialOtaState,
  otaUpdatesActive,
  reduceOta,
  type OtaEvent,
  type OtaState,
} from '@/otaUpdates';

export interface UseOtaUpdatesResult {
  /** current lifecycle status — drive an optional UI surface off this */
  status: OtaState['status'];
  /** an update has downloaded and will apply on the next activation */
  pending: boolean;
  /** false in Expo Go / dev / web — the whole mechanism is dormant */
  isActive: boolean;
  /** force a check now (applies immediately if an update is already downloaded) */
  checkNow: () => void;
  /** apply a downloaded update immediately by reloading the JS bundle */
  reloadNow: () => void;
}

/**
 * Drives EAS Update over-the-air delivery for the whole app.
 *
 * On launch and on every return to the foreground it asks the EAS Update server
 * for a newer JS bundle, downloads it, and applies it the next time the app
 * becomes active. All the decision logic lives in the pure `reduceOta` state
 * machine (`src/otaUpdates.ts`); this hook is only the `expo-updates` adapter.
 *
 * It is a complete no-op in Expo Go, in dev (Metro owns the bundle), and on the
 * web — see `otaUpdatesActive`.
 */
export function useOtaUpdates(): UseOtaUpdatesResult {
  const isActive = otaUpdatesActive({
    isEnabled: Updates.isEnabled,
    isDev: __DEV__,
    isWeb: Platform.OS === 'web',
  });

  const [state, setState] = useState<OtaState>(initialOtaState);
  const stateRef = useRef(state);
  // Guards against overlapping async check/download chains (e.g. a manual
  // `checkNow` landing while a foreground-triggered check is still running).
  const runningRef = useRef(false);

  const apply = useCallback((event: OtaEvent) => {
    const { state: next, action } = reduceOta(stateRef.current, event);
    stateRef.current = next;
    setState(next);
    return action;
  }, []);

  const trigger = useCallback(
    async (event: OtaEvent) => {
      if (!isActive || runningRef.current) return;
      runningRef.current = true;
      try {
        let action = apply(event);
        // Walk the action chain the reducer hands back until it settles.
        while (action !== 'none') {
          if (action === 'reload') {
            await Updates.reloadAsync();
            return; // the JS runtime is about to restart
          }
          if (action === 'check') {
            const result = await Updates.checkForUpdateAsync();
            action = apply({ type: 'checked', available: result.isAvailable });
          } else if (action === 'download') {
            await Updates.fetchUpdateAsync();
            action = apply({ type: 'downloaded', ok: true });
          }
        }
      } catch {
        // Network hiccup / server error — recorded as an error and retried on
        // the next activation. Never surfaced as a crash.
        apply({ type: 'failed' });
      } finally {
        runningRef.current = false;
      }
    },
    [apply, isActive],
  );

  // Check once on mount (a warm start where the native ON_LOAD check may have
  // already run) — the reducer no-ops if nothing is available.
  useEffect(() => {
    void trigger({ type: 'app-active' });
  }, [trigger]);

  // Re-check on every background → foreground transition, and apply a pending
  // update at that moment so a fresh bundle boots without interrupting use.
  useEffect(() => {
    if (!isActive) return;
    const appState = { current: AppState.currentState };
    const subscription = AppState.addEventListener('change', (next) => {
      const previous = appState.current;
      appState.current = next;
      if (next === 'active' && previous !== 'active') {
        void trigger({ type: 'app-active' });
      }
    });
    return () => subscription.remove();
  }, [isActive, trigger]);

  const checkNow = useCallback(() => {
    void trigger({ type: 'app-active' });
  }, [trigger]);

  const reloadNow = useCallback(() => {
    if (!isActive) return;
    void Updates.reloadAsync().catch(() => {
      // A failed reload is non-fatal: the downloaded update still applies on the
      // next cold launch via the native ON_LOAD check.
    });
  }, [isActive]);

  return { status: state.status, pending: state.pending, isActive, checkNow, reloadNow };
}
