import { ACCOUNT_LIMIT_NEAR_PERCENT, type AgentAccountLimit } from '@moxxy/sdk';
import type { CodexRateLimitSnapshot, CodexRateLimitWindow } from './protocol.js';

/**
 * Codex's rate limits as Moxxy's account limit, from the most used of its windows; undefined when
 * the update leaves the windows out (they stay as they were). Codex does not say when a window is
 * near, so it is near from the share Claude warns at.
 */
export function accountLimitFrom(snapshot: CodexRateLimitSnapshot): AgentAccountLimit | undefined {
  const windows = [snapshot.primary, snapshot.secondary].filter((w): w is CodexRateLimitWindow => w !== null && w !== undefined);
  const top = windows.reduce<CodexRateLimitWindow | undefined>((most, w) => (!most || w.usedPercent > most.usedPercent ? w : most), undefined);
  if (!top) return undefined;
  const reached = (snapshot.rateLimitReachedType !== null && snapshot.rateLimitReachedType !== undefined) || top.usedPercent >= 100;
  return {
    state: reached ? 'reached' : top.usedPercent >= ACCOUNT_LIMIT_NEAR_PERCENT ? 'near' : 'ok',
    usedPercent: top.usedPercent,
    ...(top.windowDurationMins !== null ? { windowMinutes: top.windowDurationMins } : {}),
    ...(top.resetsAt !== null ? { resetsAt: top.resetsAt * 1000 } : {}),
  };
}

/** Whether Codex failed a turn because the account's usage limit is used up. */
export function failedOnUsageLimit(errorInfo: unknown): boolean {
  return errorInfo === 'usageLimitExceeded';
}
