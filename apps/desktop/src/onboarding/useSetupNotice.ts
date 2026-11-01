import { useUpdateActivity } from '@moxxy/client-core';
import { setupNotice } from './setup-notice';

/** What onboarding says about the setup still running behind it; null when nothing. */
export function useSetupNotice(): string | null {
  return setupNotice(useUpdateActivity().setup);
}
