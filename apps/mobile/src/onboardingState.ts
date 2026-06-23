/**
 * First-run onboarding gate. The flag is versioned so a future redesign of the
 * intro can re-show it to everyone by bumping the key. Shared by the routing
 * gate (`app/index.tsx`) and the screen that sets it (`app/onboarding.tsx`).
 */
export const ONBOARDING_STORAGE_KEY = 'moxxy.onboarding.v1';
export const ONBOARDING_DONE_VALUE = 'done';

/** Resolve where the launch gate should send the user once the flag has loaded. */
export function resolveLaunchRoute(onboardingValue: string | null): '/onboarding' | '/chat' {
  return onboardingValue === ONBOARDING_DONE_VALUE ? '/chat' : '/onboarding';
}
