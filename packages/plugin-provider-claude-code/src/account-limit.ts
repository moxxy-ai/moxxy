import type { AgentAccountLimit } from '@moxxy/sdk';
import type { ClaudeRateLimitInfo } from './sdk-types.js';

const WINDOW_MINUTES: Readonly<Record<string, number>> = {
  five_hour: 300,
  seven_day: 10080,
  seven_day_opus: 10080,
  seven_day_sonnet: 10080,
  seven_day_overage_included: 10080,
};

/**
 * Claude's plan limit as Moxxy's account limit. A used-up window Claude goes on past with extra
 * usage is near, not reached: the person can still work.
 */
export function accountLimitFrom(info: ClaudeRateLimitInfo): AgentAccountLimit {
  const extraUsage = info.isUsingOverage === true || info.overageStatus === 'allowed' || info.overageStatus === 'allowed_warning';
  const state = info.status === 'allowed' ? 'ok' : info.status === 'rejected' && !extraUsage ? 'reached' : 'near';
  const windowMinutes = info.rateLimitType ? WINDOW_MINUTES[info.rateLimitType] : undefined;
  return {
    state,
    ...(info.resetsAt !== undefined ? { resetsAt: info.resetsAt * 1000 } : {}),
    ...(windowMinutes !== undefined ? { windowMinutes } : {}),
    ...(info.utilization !== undefined ? { usedPercent: Math.round(info.utilization * 100) } : {}),
  };
}
