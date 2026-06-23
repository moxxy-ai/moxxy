import { useEffect, useState } from 'react';

/** Hard safety cap: even if the runner claims events exist but they never
 *  stream in, the loader gives up after this and falls back to the welcome /
 *  empty state, so it can never get stuck. */
const MAX_WAIT_MS = 8000;

export interface HistoryLoaderInput {
  readonly sessionKey: string | null;
  readonly itemCount: number;
  readonly eventCount: number;
  readonly expired: boolean;
}

/** Pure decision: show the transcript loader when the active session has events
 *  on the runner (eventCount > 0) but none have streamed into the transcript
 *  yet — and we haven't hit the safety cap. A fresh session (eventCount 0) is
 *  never "loading"; it shows the welcome immediately. */
export function shouldShowHistoryLoader({ sessionKey, itemCount, eventCount, expired }: HistoryLoaderInput): boolean {
  return Boolean(sessionKey) && eventCount > 0 && itemCount === 0 && !expired;
}

/** Whether the chat transcript is still loading its history. Bulletproof: keyed
 *  on the runner's eventCount (the source of truth for "has messages"), with a
 *  per-session safety timeout so a stuck replay can't pin the loader forever. */
export function useHistoryLoading(sessionKey: string | null, itemCount: number, eventCount: number): boolean {
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    setExpired(false);
    if (!sessionKey || itemCount > 0 || eventCount <= 0) return;
    const timer = setTimeout(() => setExpired(true), MAX_WAIT_MS);
    return () => clearTimeout(timer);
  }, [sessionKey, itemCount, eventCount]);

  return shouldShowHistoryLoader({ sessionKey, itemCount, eventCount, expired });
}
