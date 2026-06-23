import { describe, expect, it } from 'vitest';
import { ONBOARDING_DONE_VALUE, resolveLaunchRoute } from '../src/onboardingState';

describe('first-run onboarding gate', () => {
  it('sends first-run users (no flag) to the animated onboarding', () => {
    expect(resolveLaunchRoute(null)).toBe('/onboarding');
    expect(resolveLaunchRoute('')).toBe('/onboarding');
    expect(resolveLaunchRoute('garbage')).toBe('/onboarding');
  });

  it('sends returning users straight to chat once onboarding is complete', () => {
    expect(resolveLaunchRoute(ONBOARDING_DONE_VALUE)).toBe('/chat');
  });
});
