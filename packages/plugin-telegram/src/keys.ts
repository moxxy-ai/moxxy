/**
 * Vault keys + token validation shared by the channel, its subcommands, and the
 * interactive setup wizard. Kept in their own module so the wizard / pair-flow
 * helpers can import them without pulling in the plugin's full index.
 */

/** Vault key the plugin uses for the Bot API token. */
export const TELEGRAM_TOKEN_KEY = 'telegram_bot_token';
/** Vault key the plugin uses for the paired chat id. */
export const TELEGRAM_AUTHORIZED_CHAT_KEY = 'telegram_authorized_chat_id';
/**
 * Vault key for the voice-replies preference. Single-paired-chat model, so a
 * simple present-flag (`'1'` = on, absent = off) keyed like the other telegram
 * keys, toggled from the paired chat via `/voice`.
 */
export const TELEGRAM_VOICE_REPLIES_KEY = 'telegram_voice_replies';
/** Regex validating a Telegram bot token (`<digits>:<22+ url-safe>`). */
export const TELEGRAM_TOKEN_RE = /^\d+:[A-Za-z0-9_-]{20,}$/;

/** The narrow vault slice the voice-replies flag helpers use. */
interface VoiceFlagVault {
  get(name: string): Promise<string | null>;
  set(name: string, value: string): Promise<void>;
  delete(name: string): Promise<boolean>;
}

/** Read the persisted voice-replies preference (`'1'` → on). */
export async function loadVoiceReplies(vault: Pick<VoiceFlagVault, 'get'>): Promise<boolean> {
  return (await vault.get(TELEGRAM_VOICE_REPLIES_KEY)) === '1';
}

/** Persist the voice-replies preference: store `'1'` when on, remove it when off. */
export async function saveVoiceReplies(
  vault: Pick<VoiceFlagVault, 'set' | 'delete'>,
  on: boolean,
): Promise<void> {
  if (on) await vault.set(TELEGRAM_VOICE_REPLIES_KEY, '1');
  else await vault.delete(TELEGRAM_VOICE_REPLIES_KEY);
}

/**
 * Parse a stored chat-id (the vault keeps it as a string). Returns `null` for a
 * missing OR corrupt value rather than letting `Number(x)` yield `NaN` — a
 * silent NaN serializes to `null` in status output (masking the corruption) and
 * would otherwise be passed to `api.sendMessage(NaN, …)` as a real target,
 * producing an opaque Telegram 400 instead of a clear "not paired" signal.
 */
export function parseChatId(raw: string | null | undefined): number | null {
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}
