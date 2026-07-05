import { useOtaUpdates } from '@/hooks/useOtaUpdates';

/**
 * Headless controller that keeps the app's JS bundle current over-the-air.
 *
 * Mounted once at the root (see `app/_layout.tsx`), alongside the other
 * app-wide controllers. It renders nothing — updates are downloaded silently
 * and applied on the next foreground. Surface `useOtaUpdates()` in a banner if
 * you ever want a visible "update ready" affordance.
 */
export function OtaUpdateController() {
  useOtaUpdates();
  return null;
}
