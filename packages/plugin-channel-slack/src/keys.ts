/**
 * Vault keys + env overrides + token validators shared by the channel, its
 * subcommands, and the interactive setup wizard. Kept in their own module so the
 * wizard / pair-flow helpers can import them without pulling in the plugin's
 * full index.
 */
import { z } from '@moxxy/sdk';

/** Vault key for the Slack bot OAuth token (`xoxb-…`). */
export const SLACK_BOT_TOKEN_KEY = 'slack_bot_token';
/** Vault key for the Slack app signing secret (HMAC over the raw request body). */
export const SLACK_SIGNING_SECRET_KEY = 'slack_signing_secret';
/**
 * Vault key for the authorized team/channel set (TOFU pairing). Stored as a
 * JSON string of an authorization record so we can grow what we pin without a
 * format change (today: `{ teamId, channelId? }`).
 */
export const SLACK_AUTHORIZED_KEY = 'slack_authorized';

/** Env override for the bot token (beats the vault, matching every other channel). */
export const SLACK_BOT_TOKEN_ENV = 'MOXXY_SLACK_BOT_TOKEN';
/** Env override for the signing secret. */
export const SLACK_SIGNING_SECRET_ENV = 'MOXXY_SLACK_SIGNING_SECRET';

/** A Slack bot token always starts with `xoxb-`. */
export const SLACK_BOT_TOKEN_RE = /^xoxb-[A-Za-z0-9-]{10,}$/;

/** zod validator for a bot token (shape only — connectivity is tested via `auth.test`). */
export const slackBotTokenSchema = z
  .string()
  .trim()
  .regex(SLACK_BOT_TOKEN_RE, 'expected a Slack bot token like "xoxb-…"');

/** zod validator for a signing secret (hex-ish; Slack uses a 32-byte hex secret). */
export const slackSigningSecretSchema = z
  .string()
  .trim()
  .min(16, 'signing secret looks too short')
  .max(256, 'signing secret looks too long');

/**
 * Resolve the bot token: env override first, then the vault. Returns null when
 * neither is set. Trimmed; never returns an empty string.
 */
export async function resolveBotToken(vault: {
  get(name: string): Promise<string | null>;
}): Promise<string | null> {
  const fromEnv = process.env[SLACK_BOT_TOKEN_ENV]?.trim();
  if (fromEnv) return fromEnv;
  const stored = (await vault.get(SLACK_BOT_TOKEN_KEY))?.trim();
  return stored || null;
}

/** Resolve the signing secret: env override first, then the vault. */
export async function resolveSigningSecret(vault: {
  get(name: string): Promise<string | null>;
}): Promise<string | null> {
  const fromEnv = process.env[SLACK_SIGNING_SECRET_ENV]?.trim();
  if (fromEnv) return fromEnv;
  const stored = (await vault.get(SLACK_SIGNING_SECRET_KEY))?.trim();
  return stored || null;
}

/** What we persist under {@link SLACK_AUTHORIZED_KEY}. */
export interface SlackAuthorization {
  readonly teamId: string;
  /** Optionally narrow authorization to a single channel. */
  readonly channelId?: string;
}

/** Parse the stored authorization record. Returns null for missing/corrupt. */
export function parseAuthorization(raw: string | null | undefined): SlackAuthorization | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<SlackAuthorization>;
    if (typeof parsed?.teamId === 'string' && parsed.teamId) {
      return parsed.channelId
        ? { teamId: parsed.teamId, channelId: parsed.channelId }
        : { teamId: parsed.teamId };
    }
  } catch {
    /* corrupt — treat as unpaired */
  }
  return null;
}

/** Does an inbound event from `(teamId, channelId)` match the stored authorization? */
export function authorizationMatches(
  auth: SlackAuthorization | null,
  teamId: string | undefined,
  channelId: string | undefined,
): boolean {
  if (!auth || !teamId) return false;
  if (auth.teamId !== teamId) return false;
  if (auth.channelId && auth.channelId !== channelId) return false;
  return true;
}
