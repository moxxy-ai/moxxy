import { useEffect, useMemo, useState } from 'react';
import { conversationAccountUsage } from '@moxxy/chat-model';
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
 * How much of its account limit the active agent has used, for the model and usage window. It
 * goes by itself when the window resets.
 */
export function useAccountLimit(events: ReadonlyArray<MoxxyEvent>, activeProvider: string | null | undefined): AccountLimitView | null {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => setNowMs(Date.now()), [events, activeProvider]);
  const limit = useMemo(() => conversationAccountUsage(events, activeProvider, nowMs), [events, activeProvider, nowMs]);
  const resetsAt = limit ? limit.limit.resetsAt : undefined;
  useEffect(() => {
    if (resetsAt === undefined) return;
    const timer = setTimeout(() => setNowMs(Date.now()), Math.min(Math.max(resetsAt - Date.now(), 0), LONGEST_TIMEOUT));
    return () => clearTimeout(timer);
  }, [resetsAt, nowMs]);
  return limit ? { limit, nowMs } : null;
}
