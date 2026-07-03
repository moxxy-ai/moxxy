/**
 * Vault keys + validation shared by the channel, its subcommands, and the
 * interactive setup wizard. Kept in their own module (the telegram/slack
 * `keys.ts` pattern) so wizard / pair-flow helpers can import them without
 * pulling in the plugin's full index.
 *
 * Note on secret custody: signal-cli keeps the actual Signal identity keys +
 * message store in ITS OWN data dir (`$XDG_DATA_HOME/signal-cli/`, i.e.
 * `~/.local/share/signal-cli/` by default — see {@link signalCliDataDir}).
 * The moxxy vault only stores the account NUMBER and the sender allow-list;
 * there is no API token in this channel at all.
 */

/** Vault key for the linked Signal account number (E.164). */
export const SIGNAL_ACCOUNT_KEY = 'signal_account';
/** Env override for the account number — beats the vault (shared precedence). */
export const SIGNAL_ACCOUNT_ENV = 'MOXXY_SIGNAL_ACCOUNT';
/**
 * Vault key for the sender allow-list: a JSON array of E.164 numbers and/or
 * Signal account UUIDs that may drive the session. The linked account's own
 * "Note to Self" is allowed implicitly and does not need an entry here.
 */
export const SIGNAL_ALLOWED_SENDERS_KEY = 'signal_allowed_senders';

/** E.164 shape: `+` then 7–15 digits, no leading zero. */
export const E164_RE = /^\+[1-9]\d{6,14}$/;

/** Loose UUID shape (Signal ACIs are UUIDv4; accept any hex-dash UUID). */
export const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** Canonical sender identity for allow-list comparisons: trimmed, UUIDs lowercased. */
export function normalizeSender(raw: string): string {
  const trimmed = raw.trim();
  return UUID_RE.test(trimmed) ? trimmed.toLowerCase() : trimmed;
}

/**
 * Parse the stored allow-list. Returns `[]` for a missing OR corrupt value
 * rather than throwing — a corrupt vault entry must degrade to "nobody extra
 * is allowed" (fail closed), never crash the channel or silently allow.
 * Non-string entries and entries that look like neither an E.164 number nor a
 * UUID are dropped.
 */
export function parseAllowedSenders(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((x): x is string => typeof x === 'string')
      .map(normalizeSender)
      .filter((x) => E164_RE.test(x) || UUID_RE.test(x));
  } catch {
    return [];
  }
}
