import type { AppSetupState } from '@moxxy/desktop-ipc-contract';
import { SETUP_STEPS } from '../update/update-screen-model';

/**
 * What onboarding says while the launch still sets up behind it: the setup
 * screen waits until onboarding is done, and until then a sign-in or a new
 * workspace would seem to hang. Null when there is nothing to say.
 */
export function setupNotice(setup: AppSetupState | null): string | null {
  if (!setup || setup.reason === null || setup.phase === 'done') return null;
  const running = setup.steps.findIndex((step) => step.status === 'running');
  const at = running >= 0 ? running : setup.steps.findIndex((step) => step.status === 'pending');
  const step = setup.steps[at];
  if (!step) return null;
  return `Moxxy is still setting up: ${SETUP_STEPS[step.id]} (${at + 1} of ${setup.steps.length}). Signing in and starting the agent wait until it is done.`;
}
