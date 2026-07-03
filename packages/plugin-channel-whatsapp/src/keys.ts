/**
 * Vault keys + pure JID helpers shared by the channel, its subcommands, and the
 * interactive setup wizard. Kept in their own module so the wizard / pair-flow
 * helpers can import them without pulling in the plugin's full index (or, worse,
 * Baileys — which stays behind a lazy import in `baileys-socket.ts`).
 */

/** Vault key holding the user's typed acknowledgment of the ToS/ban risk. */
export const WHATSAPP_CONSENT_KEY = 'whatsapp_tos_acknowledged';
/** Vault key holding the linked account's own (normalized) JID. */
export const WHATSAPP_OWNER_JID_KEY = 'whatsapp_owner_jid';
/** Vault key holding extra allow-listed JIDs (JSON array or comma-separated). */
export const WHATSAPP_ALLOWED_JIDS_KEY = 'whatsapp_allowed_jids';
/** Env override for the consent gate (headless/dedicated runners). */
export const WHATSAPP_CONSENT_ENV = 'MOXXY_WHATSAPP_TOS_ACK';
/** Directory (under the moxxy home) holding the rotating Baileys auth state. */
export const WHATSAPP_AUTH_DIR = 'whatsapp-auth';

/**
 * Normalize a WhatsApp JID for identity comparison: the user part of a
 * multi-device JID carries `:device` (and historically `_agent`) suffixes that
 * vary per login (`1234567890:12@s.whatsapp.net`), so equality checks must
 * compare the bare `user@server` form. Returns null for values that don't look
 * like a JID at all, so callers treat garbage as "no identity" instead of
 * silently allow-listing it.
 */
export function normalizeJid(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > 256) return null;
  const at = trimmed.indexOf('@');
  if (at <= 0 || at !== trimmed.lastIndexOf('@')) return null;
  const server = trimmed.slice(at + 1).toLowerCase();
  if (!/^[a-z0-9.-]+$/.test(server)) return null;
  // Strip the device (`:NN`) and legacy agent (`_N`) suffixes off the user part.
  const user = trimmed.slice(0, at).split(':')[0]!.split('_')[0]!;
  if (user.length === 0) return null;
  return `${user}@${server}`;
}

/**
 * Parse a stored/configured allow-list. Accepts a JSON string array or a
 * comma/whitespace-separated string; every entry is normalized and non-JIDs are
 * dropped (never silently allow-listed). Returns a de-duplicated array.
 */
export function parseAllowedJids(raw: string | null | undefined): string[] {
  if (raw == null) return [];
  let entries: unknown[] = [];
  const trimmed = raw.trim();
  if (trimmed.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed)) entries = parsed;
    } catch {
      return [];
    }
  } else {
    entries = trimmed.split(/[,\s]+/);
  }
  const out = new Set<string>();
  for (const entry of entries) {
    const jid = normalizeJid(typeof entry === 'string' ? entry : null);
    if (jid) out.add(jid);
  }
  return [...out];
}

/**
 * Whether a stored consent value counts as an actual acknowledgment. The setup
 * wizard stores `acknowledged@<ISO date>`; the desktop panel / `moxxy init`
 * declarative field stores whatever the user typed — only an affirmative "yes"
 * counts, so typing "no" into the form does NOT arm the channel.
 */
export function isConsentValue(raw: string | null | undefined): boolean {
  if (typeof raw !== 'string') return false;
  const v = raw.trim().toLowerCase();
  return v === 'yes' || v.startsWith('acknowledged@');
}
