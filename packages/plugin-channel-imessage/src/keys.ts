/**
 * Vault keys + pure handle helpers shared by the channel, its subcommands, and
 * the interactive setup wizard. Kept in their own module (the signal/whatsapp
 * `keys.ts` pattern) so wizard helpers can import them without pulling in the
 * plugin's full index (or, worse, socket.io-client — which stays behind a lazy
 * import in `bluebubbles-client.ts`).
 *
 * Note on custody: the BlueBubbles server (a native macOS app) holds the actual
 * iMessage identity + message store. The moxxy vault only stores the localhost
 * server URL, its password, and two JSON handle arrays — the allow-list of OTHER
 * people who may drive the agent, and the owner's own handle(s) that enable
 * texting moxxy from your own devices (the "self-chat").
 */

/** Vault key for the BlueBubbles server URL (e.g. http://localhost:1234). */
export const IMESSAGE_SERVER_URL_KEY = 'imessage_server_url';
/** Env override for the server URL — beats the vault (shared precedence). */
export const IMESSAGE_SERVER_URL_ENV = 'MOXXY_IMESSAGE_SERVER_URL';
/** Vault key for the BlueBubbles server password. */
export const IMESSAGE_SERVER_PASSWORD_KEY = 'imessage_server_password';
/** Env override for the server password — beats the vault. */
export const IMESSAGE_SERVER_PASSWORD_ENV = 'MOXXY_IMESSAGE_SERVER_PASSWORD';
/**
 * Vault key for the allow-list: a JSON array of iMessage handles (E.164 phone
 * numbers and/or Apple-ID emails) that OTHER people may use to drive the
 * session. The owner's own handle is NOT listed here — it lives in
 * {@link IMESSAGE_OWNER_HANDLES_KEY} so an inbound from a friend and an outbound
 * from the owner stay distinguishable (never react to the owner's private
 * conversations with allow-listed friends).
 */
export const IMESSAGE_ALLOWED_HANDLES_KEY = 'imessage_allowed_handles';
/**
 * Vault key for the owner's OWN handle(s): a JSON array of the account owner's
 * E.164 numbers / Apple-ID emails. A message the account itself sent
 * (`isFromMe`) drives a turn only when it lands in a 1:1 chat with one of these
 * handles — i.e. the owner texting their own "self-chat" from any Apple device.
 * Empty (the default) means self-chat is off and every `isFromMe` message is
 * dropped (fail closed); the friend allow-list path is unaffected.
 */
export const IMESSAGE_OWNER_HANDLES_KEY = 'imessage_owner_handles';

/** E.164 shape: `+` then 7–15 digits, no leading zero. */
export const E164_RE = /^\+[1-9]\d{6,14}$/;

/** Pragmatic email shape (Apple-ID handles). Deliberately loose but anchored. */
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Whether a normalized string is a plausible iMessage handle. */
export function isHandle(value: string): boolean {
  return E164_RE.test(value) || EMAIL_RE.test(value);
}

/**
 * Canonical handle for allow-list comparisons: trimmed, and lowercased when it
 * is an email (Apple-ID handles are case-insensitive). Phone numbers are left
 * as-is (they are already digits + `+`).
 */
export function normalizeHandle(raw: string): string {
  const trimmed = raw.trim();
  return trimmed.includes('@') ? trimmed.toLowerCase() : trimmed;
}

/**
 * Parse a stored handle list. Returns `[]` for a missing OR corrupt value
 * rather than throwing — a corrupt vault entry must degrade to "nobody extra is
 * allowed" (fail closed), never crash the channel or silently allow. Non-string
 * entries and entries that are neither an E.164 number nor an email are dropped.
 */
export function parseHandleList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out = new Set<string>();
  for (const entry of parsed) {
    if (typeof entry !== 'string') continue;
    const handle = normalizeHandle(entry);
    if (isHandle(handle)) out.add(handle);
  }
  return [...out];
}

/**
 * Parse the chat GUID BlueBubbles stamps on every message
 * (`SERVICE;TYPE;IDENTIFIER`, e.g. `iMessage;-;+15551234567`). TYPE is `-` for a
 * 1:1 chat and `+` for a group. Returns null for anything that is not a
 * well-formed 1:1 GUID (groups included) so callers treat it as "not a DM" and
 * drop it (v1 is direct-message only).
 */
export function parseDmChatGuid(
  guid: string | null | undefined,
): { readonly service: string; readonly handle: string } | null {
  if (typeof guid !== 'string') return null;
  const parts = guid.split(';');
  if (parts.length !== 3) return null;
  const [rawService, rawType, rawIdentifier] = parts;
  if (rawService === undefined || rawType === undefined || rawIdentifier === undefined) return null;
  const service = rawService.trim();
  const type = rawType.trim();
  const identifier = rawIdentifier.trim();
  if (service.length === 0 || type !== '-' || identifier.length === 0) return null;
  const handle = normalizeHandle(identifier);
  if (!isHandle(handle)) return null;
  return { service, handle };
}
