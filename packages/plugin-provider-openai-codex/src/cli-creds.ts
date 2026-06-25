/**
 * Borrow the OAuth tokens minted by a locally-installed Codex CLI.
 *
 * The `codex` CLI persists its ChatGPT-plan OAuth bundle to
 * `$CODEX_HOME/auth.json` (default `~/.codex/auth.json`) — the SAME OAuth
 * client moxxy's `openai-codex` provider uses, so the access/refresh tokens
 * found there are directly usable. This lets a user who has already signed in
 * with `codex` skip a separate `moxxy login openai-codex`.
 *
 * Lifecycle ("borrow live"): the installed CLI stays the OWNER of the token.
 * moxxy reads it on demand and, when the access token is near/at expiry,
 * prefers a fresher token the CLI may have written since (via `reloadTokens`).
 * Only when the CLI's stored token is itself stale does moxxy refresh — and it
 * then WRITES THE ROTATED BUNDLE BACK to `auth.json` so the two stay in sync
 * and the CLI doesn't hit `invalid_grant` on its next run. The refresh token
 * rotates and is single-use, so this write-back is what keeps moxxy and the
 * CLI from invalidating each other.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFile, writeFile, rename, chmod, unlink } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import { parseJwtClaims, extractAccountId } from './oauth.js';
import type { CodexTokens } from './types.js';

/** Shape of `auth.json` as written by codex-rs. Fields we don't touch are preserved. */
interface CodexAuthFile {
  readonly OPENAI_API_KEY?: string | null;
  readonly auth_mode?: string;
  readonly tokens?: {
    readonly id_token?: string;
    readonly access_token?: string;
    readonly refresh_token?: string;
    readonly account_id?: string;
  };
  readonly last_refresh?: string;
  readonly [k: string]: unknown;
}

/** Absolute path to the installed CLI's auth file (honors `CODEX_HOME`). */
export function codexAuthPath(): string {
  const overridden = process.env.CODEX_HOME?.trim();
  const base = overridden && overridden.length > 0 ? overridden : join(homedir(), '.codex');
  return join(base, 'auth.json');
}

/** `exp` (seconds) from a JWT, in epoch-ms; undefined when absent/unparseable. */
function jwtExpiryMs(jwt: string | undefined): number | undefined {
  if (!jwt) return undefined;
  const claims = parseJwtClaims(jwt);
  const exp = claims?.['exp'];
  return typeof exp === 'number' && Number.isFinite(exp) ? exp * 1000 : undefined;
}

/**
 * Read the installed Codex CLI's stored tokens, normalized to `CodexTokens`.
 * Returns null when the file is missing / unreadable / malformed, or when it
 * doesn't carry the access+refresh pair the borrow-live lifecycle needs.
 *
 * `expires` comes from the access_token JWT's `exp` (authoritative); when that
 * can't be read we fall back to the id_token's, and finally to "already
 * expired" so the provider refreshes-and-writes-back on first use rather than
 * firing a request on a token of unknown freshness.
 */
export async function readInstalledCodexTokens(): Promise<CodexTokens | null> {
  let raw: string;
  try {
    raw = await readFile(codexAuthPath(), 'utf8');
  } catch {
    return null;
  }
  let parsed: CodexAuthFile;
  try {
    const json: unknown = JSON.parse(raw);
    if (!json || typeof json !== 'object') return null;
    parsed = json as CodexAuthFile;
  } catch {
    return null;
  }
  const t = parsed.tokens;
  // Need BOTH tokens: the access token to call the API, the refresh token so
  // the borrow-live path can recover when the access token has expired (which,
  // for an unused CLI, it usually has).
  if (!t || typeof t.access_token !== 'string' || typeof t.refresh_token !== 'string') {
    return null;
  }
  const expires =
    jwtExpiryMs(t.access_token) ?? jwtExpiryMs(t.id_token) ?? 0;
  const accountId =
    t.account_id ??
    extractAccountId({
      ...(t.id_token ? { id_token: t.id_token } : {}),
      access_token: t.access_token,
    });
  return {
    access: t.access_token,
    refresh: t.refresh_token,
    expires,
    ...(accountId ? { accountId } : {}),
  };
}

/**
 * Write a refreshed token bundle back into the installed CLI's `auth.json`,
 * preserving every other field (api key, auth_mode, id_token) so the codex CLI
 * keeps working. Atomic (temp file + rename) and best-effort: a failure here
 * must NOT break moxxy's in-memory session — the caller still has the fresh
 * token; the only cost of a failed write-back is the CLI re-authing later.
 */
export async function writeInstalledCodexTokens(next: CodexTokens): Promise<void> {
  const path = codexAuthPath();
  let existing: CodexAuthFile = {};
  try {
    const json: unknown = JSON.parse(await readFile(path, 'utf8'));
    if (json && typeof json === 'object') existing = json as CodexAuthFile;
  } catch {
    // No/garbled existing file — write a minimal valid one. The CLI rewrites
    // the rest (id_token etc.) on its next refresh.
  }
  const merged = {
    ...existing,
    auth_mode: existing.auth_mode ?? 'chatgpt',
    tokens: {
      ...(existing.tokens ?? {}),
      access_token: next.access,
      refresh_token: next.refresh,
      ...(next.accountId ? { account_id: next.accountId } : {}),
    },
    last_refresh: new Date().toISOString(),
  };
  // Same dir as the target so rename() is atomic (no cross-device copy), and a
  // unique suffix so two concurrent writers don't clobber one temp file.
  const tmp = `${path}.${webcrypto.randomUUID()}.tmp`;
  await writeFile(tmp, JSON.stringify(merged, null, 2), { mode: 0o600 });
  try {
    await chmod(tmp, 0o600);
    await rename(tmp, path);
  } catch (err) {
    // Clean up the temp file on a failed rename so we don't litter ~/.codex.
    await unlink(tmp).catch(() => {});
    throw err;
  }
}
