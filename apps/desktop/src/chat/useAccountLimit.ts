import { useEffect, useMemo, useState } from 'react';
import { conversationAccountLimit } from '@moxxy/chat-model';
import type { MoxxyEvent } from '@moxxy/sdk';
import type { RecordedAccountLimit } from '@moxxy/sdk/agent-account-limit';

export interface AccountLimitView {
  readonly limit: RecordedAccountLimit;
  /** The time the text is said against ("at 18:00" today, "tomorrow at …"). */
  readonly nowMs: number;
}

/** A timeout longer than this fires at once in browsers; a later reset is re-checked on the way. */
const LONGEST_TIMEOUT = 2_147_483_647;

/**
 * The active agent's account limit while it holds, for the bar above the message box. It goes
 * by itself when the window resets.
 */
export function useAccountLimit(events: ReadonlyArray<MoxxyEvent>, activeProvider: string | null | undefined): AccountLimitView | null {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => setNowMs(Date.now()), [events, activeProvider]);
  const limit = useMemo(() => conversationAccountLimit(events, activeProvider, nowMs), [events, activeProvider, nowMs]);
  const resetsAt = limit ? limit.limit.resetsAt : undefined;
  useEffect(() => {
    if (resetsAt === undefined) return;
    const timer = setTimeout(() => setNowMs(Date.now()), Math.min(Math.max(resetsAt - Date.now(), 0), LONGEST_TIMEOUT));
    return () => clearTimeout(timer);
  }, [resetsAt, nowMs]);
  return limit ? { limit, nowMs } : null;
}
