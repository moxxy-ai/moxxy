/**
 * Vault keys + env overrides + validators shared by the channel, its
 * subcommands, and the interactive setup wizard. Kept in their own module so
 * the wizard / pair-flow helpers can import them without pulling in the
 * plugin's full index. The names here are the single source of truth for what
 * the channel reads at boot (mirrored by the desktop channel catalog).
 */
import { z } from '@moxxy/sdk';
import { resolveSecret } from '@moxxy/channel-kit';

/** Vault key for the Discord bot token. */
export const DISCORD_TOKEN_KEY = 'discord_bot_token';
/** Vault key for the paired (authorized) Discord user id — the sole principal
 *  allowed to drive the session. */
export const DISCORD_AUTHORIZED_USER_KEY = 'discord_authorized_user_id';
/** Vault key for the guild-channel allow-list (JSON array of channel ids the
 *  paired user may drive the bot from, beyond their own DM). */
export const DISCORD_ALLOWED_CHANNELS_KEY = 'discord_allowed_channel_ids';
/**
 * Vault key for the voice-replies preference. Single-paired-account model, so a
 * present-flag (`'1'` = on, absent = off) toggled from a DM / allow-listed
 * channel via `/voice`.
 */
export const DISCORD_VOICE_REPLIES_KEY = 'discord_voice_replies';

/** Env override for the bot token (beats the vault, matching every other channel). */
export const DISCORD_TOKEN_ENV = 'MOXXY_DISCORD_TOKEN';

/**
 * Shape-only validation of a Discord bot token: three dot-separated url-safe
 * base64 segments (id.timestamp.hmac). Connectivity is proven by the gateway
 * login, not here.
 */
export const DISCORD_TOKEN_RE = /^[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{20,}$/;

/** A Discord snowflake id — numeric string, 5..25 digits. */
export const snowflakeSchema = z.string().regex(/^\d{5,25}$/, 'expected a Discord snowflake id');

/**
 * Resolve the bot token: env override first, then the vault (the shared
 * env→vault resolution in @moxxy/channel-kit). Returns null when neither is
 * set. Trimmed; never returns an empty string.
 */
export async function resolveBotToken(vault: {
  get(name: string): Promise<string | null>;
}): Promise<string | null> {
  return resolveSecret(vault, { envVar: DISCORD_TOKEN_ENV, vaultKey: DISCORD_TOKEN_KEY });
}

/**
 * Parse the stored authorized-user id. Returns null for a missing OR corrupt
 * value (anything that isn't a snowflake) so a bad vault write reads as
 * "unpaired" instead of silently authorizing garbage.
 */
export function parseAuthorizedUser(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  return snowflakeSchema.safeParse(trimmed).success ? trimmed : null;
}

const allowedChannelsSchema = z.array(snowflakeSchema);

/**
 * Parse the stored guild-channel allow-list (a JSON array of snowflakes).
 * Corrupt/missing values read as the empty list — DENY every guild channel —
 * rather than throwing or letting junk ids through.
 */
export function parseAllowedChannels(raw: string | null | undefined): ReadonlyArray<string> {
  if (!raw) return [];
  try {
    const parsed = allowedChannelsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

/** Serialize the allow-list for the vault (deduplicated, stable order). */
export function serializeAllowedChannels(ids: Iterable<string>): string {
  return JSON.stringify([...new Set(ids)]);
}

/** Read the persisted voice-replies preference (`'1'` → on). */
export async function loadVoiceReplies(vault: {
  get(name: string): Promise<string | null>;
}): Promise<boolean> {
  return (await vault.get(DISCORD_VOICE_REPLIES_KEY)) === '1';
}

/** Persist the voice-replies preference: store `'1'` when on, remove it when off. */
export async function saveVoiceReplies(
  vault: {
    set(name: string, value: string): Promise<void>;
    delete(name: string): Promise<boolean>;
  },
  on: boolean,
): Promise<void> {
  if (on) await vault.set(DISCORD_VOICE_REPLIES_KEY, '1');
  else await vault.delete(DISCORD_VOICE_REPLIES_KEY);
}
