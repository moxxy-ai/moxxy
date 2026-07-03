import { WHATSAPP_CONSENT_ENV, WHATSAPP_CONSENT_KEY, isConsentValue } from './keys.js';

/** The read/write vault slice the consent gate needs. */
export interface ConsentVault {
  get(name: string): Promise<string | null>;
  set(name: string, value: string, tags?: ReadonlyArray<string>): Promise<void>;
}

/**
 * The non-negotiable warning shown as the FIRST step of every setup path.
 * Baileys speaks the WhatsApp Web protocol without WhatsApp's blessing;
 * users must opt in to that risk explicitly before anything else happens.
 */
export const CONSENT_WARNING =
  'This channel uses Baileys, an UNOFFICIAL WhatsApp Web client.\n' +
  '\n' +
  '  - Automating an account this way violates WhatsApp\'s Terms of Service.\n' +
  '  - WhatsApp actively detects unofficial clients and CAN PERMANENTLY BAN\n' +
  '    the phone number — without warning and without appeal.\n' +
  '  - Strongly consider linking a SECONDARY number, not your personal one.\n' +
  '\n' +
  'moxxy cannot make this safe; it can only make it explicit.';

/** One-line refusal used by every path that hits the gate un-acknowledged. */
export const CONSENT_REQUIRED_MESSAGE =
  'WhatsApp channel not acknowledged: it relies on an unofficial API that violates ' +
  "WhatsApp's ToS and can get the number banned. Run `moxxy whatsapp setup` and type " +
  `'yes' to accept that risk (or set ${WHATSAPP_CONSENT_ENV}=yes for headless runs).`;

/**
 * Whether the operator has acknowledged the ToS/ban risk. Env override first
 * (headless/dedicated runners), then the vault receipt written by the wizard or
 * the desktop config panel. Vault errors (locked/unavailable) count as "no".
 */
export async function hasConsent(vault: ConsentVault | undefined): Promise<boolean> {
  if (isConsentValue(process.env[WHATSAPP_CONSENT_ENV])) return true;
  if (!vault) return false;
  try {
    return isConsentValue(await vault.get(WHATSAPP_CONSENT_KEY));
  } catch {
    return false;
  }
}

/** Persist the wizard's typed acknowledgment as a dated receipt. */
export async function recordConsent(vault: ConsentVault): Promise<void> {
  await vault.set(WHATSAPP_CONSENT_KEY, `acknowledged@${new Date().toISOString()}`, ['whatsapp']);
}
