/**
 * Reads the schedule list again once the soonest run is due, so its card shows
 * the new "last run" and next time within seconds instead of on the next
 * 30-second poll. The scheduler checks only every 30 seconds, so a run starts
 * up to that long after its moment: until it does (the soonest time changes),
 * the list is read every few seconds, for at most one scheduler check. The
 * poll stays the fallback for everything else.
 */

import { useEffect } from 'react';

/** How often the list is read while the soonest run is due but not started. */
export const RUN_SETTLE_MS = 5_000;

/** How long after its moment a run can still be starting: one scheduler check and a bit. */
export const LATE_RUN_WATCH_MS = 40_000;

// setTimeout overflows past 2^31-1 ms (~24.8 days) and would fire at once.
const MAX_DELAY_MS = 2_147_483_647;

export function useRefreshAfterNextRun(soonestFireAt: number | null, refresh: () => unknown): void {
  useEffect(() => {
    if (soonestFireAt === null) return undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = (): void => {
      const now = Date.now();
      if (now - soonestFireAt > LATE_RUN_WATCH_MS) return;
      const delay = Math.min(Math.max(soonestFireAt - now, 0) + RUN_SETTLE_MS, MAX_DELAY_MS);
      timer = setTimeout(() => {
        void refresh();
        arm();
      }, delay);
    };
    arm();
    return () => clearTimeout(timer);
  }, [soonestFireAt, refresh]);
}
