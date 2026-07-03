import { isCancel, log, note, text } from '@clack/prompts';
import { CONSENT_WARNING, hasConsent, recordConsent, type ConsentVault } from './consent.js';

/**
 * The interactive consent gate — the FIRST step of every setup surface. Shows
 * the unofficial-API warning and requires a literally typed "yes" before
 * anything else may happen; anything less refuses. Returns true only when the
 * risk is (or already was) acknowledged.
 */
export async function ensureConsentInteractive(vault: ConsentVault): Promise<boolean> {
  if (await hasConsent(vault)) {
    // Already acknowledged — keep the reminder visible but don't re-demand typing.
    log.warn('Reminder: unofficial WhatsApp API — the linked number can be banned.');
    return true;
  }
  note(CONSENT_WARNING, 'READ THIS FIRST');
  const answer = await text({
    message: "Type 'yes' to acknowledge the risk and continue (anything else aborts)",
    placeholder: 'yes',
  });
  if (isCancel(answer) || String(answer).trim().toLowerCase() !== 'yes') {
    log.error('Not acknowledged — leaving the WhatsApp channel disarmed.');
    return false;
  }
  await recordConsent(vault);
  log.success('Acknowledgment recorded.');
  return true;
}
