import { describe, expect, it } from 'vitest';
import { resolveAutoApproveState } from '../mobile/src/autoApproveState';

describe('mobile auto-approve ui state', () => {
  it('uses optimistic value immediately after the user toggles bypass mode', () => {
    expect(resolveAutoApproveState({ upstream: false, optimistic: true })).toBe(true);
    expect(resolveAutoApproveState({ upstream: true, optimistic: false })).toBe(false);
  });

  it('falls back to upstream snapshot when there is no optimistic value', () => {
    expect(resolveAutoApproveState({ upstream: false, optimistic: null })).toBe(false);
    expect(resolveAutoApproveState({ upstream: true, optimistic: null })).toBe(true);
  });
});
