import { describe, expect, it } from 'vitest';
import {
  AUTO_APPROVE_OPTIMISTIC_TIMEOUT_MS,
  resolveAutoApproveState,
  shouldRollbackAutoApproveOptimistic,
} from '../src/autoApproveState';

describe('mobile auto-approve ui state', () => {
  it('uses optimistic value immediately after the user toggles bypass mode', () => {
    expect(resolveAutoApproveState({ upstream: false, optimistic: true })).toBe(true);
    expect(resolveAutoApproveState({ upstream: true, optimistic: false })).toBe(false);
  });

  it('falls back to upstream snapshot when there is no optimistic value', () => {
    expect(resolveAutoApproveState({ upstream: false, optimistic: null })).toBe(false);
    expect(resolveAutoApproveState({ upstream: true, optimistic: null })).toBe(true);
  });

  it('rolls back an unacknowledged optimistic toggle after the ack window', () => {
    const startedAt = 1_000;

    expect(shouldRollbackAutoApproveOptimistic({
      optimistic: true,
      optimisticStartedAtMs: startedAt,
      nowMs: startedAt + AUTO_APPROVE_OPTIMISTIC_TIMEOUT_MS - 1,
    })).toBe(false);

    expect(shouldRollbackAutoApproveOptimistic({
      optimistic: true,
      optimisticStartedAtMs: startedAt,
      nowMs: startedAt + AUTO_APPROVE_OPTIMISTIC_TIMEOUT_MS,
    })).toBe(true);
  });
});
