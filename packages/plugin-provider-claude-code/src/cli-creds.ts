/**
 * Borrow the OAuth token minted by a locally-installed Claude Code CLI.
 *
 * The `claude` CLI persists its Pro/Max subscription OAuth bundle to the macOS
 * Keychain (generic password, service `Claude Code-credentials`) or, on
 * Linux/other, to `~/.claude/.credentials.json`. It's the SAME OAuth client
 * moxxy's `claude-code` provider uses, so the bearer found there is directly
 * usable against the Anthropic Messages API (verified end-to-end) — letting a
 * user who already ran `claude` skip a separate `moxxy login claude-code`.
 *
 * Lifecycle ("borrow live"): the installed CLI stays the OWNER of the token.
 * moxxy reads it on demand; the refresh hook re-reads the store first (so a
 * token the CLI just rotated is picked up for free). Only when the store's
 * token is itself stale does moxxy refresh against the IdP and WRITE THE
 * ROTATED BUNDLE BACK to the same store, so the CLI doesn't hit `invalid_grant`
 * on its next run. (Refresh tokens rotate + are single-use, so the write-back
 * is what stops moxxy and the CLI invalidating each other.)
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFile, writeFile, rename, chmod, unlink } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { webcrypto } from 'node:crypto';

const execFileAsync = promisify(execFile);

/** Keychain service name the `claude` CLI stores its credentials under (macOS). */
const KEYCHAIN_SERVICE = 'Claude Code-credentials';
/** Default keychain account when the existing item's account can't be read. */
const KEYCHAIN_DEFAULT_ACCOUNT = 'Claude Code';

/** Normalized view of the installed CLI's stored Claude credentials. */
export interface InstalledClaudeCreds {
  readonly accessToken: string;
  /** Present when the store carries a refresh token (drives stale-token recovery). */
  readonly refreshToken?: string;
  /** Epoch-ms expiry, when the store records one. */
  readonly expiresAt?: number;
  /** e.g. `max` / `pro` — informational, surfaced in the "connected via" badge. */
  readonly subscriptionType?: string;
}

/** Linux/other fallback path for the credentials file. */
function credentialsFilePath(): string {
  return join(homedir(), '.claude', '.credentials.json');
}

/**
 * Explicit override path for the credentials file. When set, the Keychain is
 * bypassed entirely and this file is read/written instead. Doubles as the test
 * seam (so tests never touch the real Keychain) and a production escape hatch
 * for non-standard installs.
 */
function credentialsFileOverride(): string | undefined {
  const v = process.env.MOXXY_CLAUDE_CREDENTIALS_FILE?.trim();
  return v && v.length > 0 ? v : undefined;
}

/** Pull the `claudeAiOauth` bundle out of either nesting the CLI may write. */
function parseClaudeCreds(raw: string): InstalledClaudeCreds | null {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!json || typeof json !== 'object') return null;
  const root = json as Record<string, unknown>;
  const nested = root['claudeAiOauth'];
  const o = (nested && typeof nested === 'object' ? nested : root) as Record<string, unknown>;
  const accessToken = o['accessToken'];
  if (typeof accessToken !== 'string' || accessToken.length === 0) return null;
  const refreshToken = o['refreshToken'];
  const expiresAt = o['expiresAt'];
  const subscriptionType = o['subscriptionType'];
  return {
    accessToken,
    ...(typeof refreshToken === 'string' && refreshToken ? { refreshToken } : {}),
    ...(typeof expiresAt === 'number' && Number.isFinite(expiresAt) ? { expiresAt } : {}),
    ...(typeof subscriptionType === 'string' && subscriptionType ? { subscriptionType } : {}),
  };
}

/**
 * Read the installed Claude CLI's stored credentials, or null when there's
 * nothing usable (not signed in, `security` unavailable, file missing/garbled).
 * macOS reads the Keychain via `security`; everything else reads the file.
 */
export async function readInstalledClaudeCreds(): Promise<InstalledClaudeCreds | null> {
  const override = credentialsFileOverride();
  if (override) {
    try {
      return parseClaudeCreds(await readFile(override, 'utf8'));
    } catch {
      return null;
    }
  }
  if (process.platform === 'darwin') {
    try {
      const { stdout } = await execFileAsync('security', [
        'find-generic-password',
        '-s',
        KEYCHAIN_SERVICE,
        '-w',
      ]);
      const creds = parseClaudeCreds(stdout.trim());
      if (creds) return creds;
    } catch {
      // Item missing / `security` not present / access denied — fall through to
      // the file path, which some setups (or a future CLI) may use even on mac.
    }
  }
  try {
    return parseClaudeCreds(await readFile(credentialsFilePath(), 'utf8'));
  } catch {
    return null;
  }
}

/** Build the on-disk/keychain JSON the `claude` CLI expects to read back. */
function serializeClaudeCreds(creds: InstalledClaudeCreds): string {
  return JSON.stringify({
    claudeAiOauth: {
      accessToken: creds.accessToken,
      ...(creds.refreshToken ? { refreshToken: creds.refreshToken } : {}),
      ...(creds.expiresAt !== undefined ? { expiresAt: creds.expiresAt } : {}),
      ...(creds.subscriptionType ? { subscriptionType: creds.subscriptionType } : {}),
    },
  });
}

/** Read the existing keychain item's account name so write-back targets it. */
async function keychainAccount(): Promise<string> {
  try {
    // Attributes only (no `-g`/`-w`, so the password is NOT printed). The
    // account appears as: "acct"<blob>="<value>"
    const { stdout } = await execFileAsync('security', [
      'find-generic-password',
      '-s',
      KEYCHAIN_SERVICE,
    ]);
    const m = stdout.match(/"acct"<blob>="([^"]*)"/);
    if (m && m[1]) return m[1];
  } catch {
    // fall through to the default account
  }
  return KEYCHAIN_DEFAULT_ACCOUNT;
}

/**
 * Write a refreshed bundle back into the installed CLI's store so it stays in
 * sync with moxxy after a moxxy-initiated refresh. Best-effort: a failure here
 * must NOT break the in-memory session (the caller already holds the fresh
 * token); the only cost is the CLI re-authing later.
 *
 * macOS caveat: `security add-generic-password -U` rewrites the item, which can
 * reset its ACL — so after a moxxy-driven refresh of a STALE token the `claude`
 * CLI may prompt once on its next launch. This never fires on the common path
 * (an active CLI keeps its token fresh, so moxxy only ever reads).
 */
export async function writeInstalledClaudeCreds(creds: InstalledClaudeCreds): Promise<void> {
  const payload = serializeClaudeCreds(creds);
  const override = credentialsFileOverride();
  if (!override && process.platform === 'darwin') {
    const account = await keychainAccount();
    // `-U` updates in place if the item exists. The token rides in argv (briefly
    // visible to local `ps`), matching how the CLIs themselves shell out; this
    // is the user's own machine and the write only happens on a stale-token
    // refresh, so the exposure window is negligible.
    await execFileAsync('security', [
      'add-generic-password',
      '-U',
      '-s',
      KEYCHAIN_SERVICE,
      '-a',
      account,
      '-w',
      payload,
    ]);
    return;
  }
  // File path (override or Linux/other default): atomic write (temp + rename) at 0600.
  const path = override ?? credentialsFilePath();
  const tmp = `${path}.${webcrypto.randomUUID()}.tmp`;
  await writeFile(tmp, payload, { mode: 0o600 });
  try {
    await chmod(tmp, 0o600);
    await rename(tmp, path);
  } catch (err) {
    await unlink(tmp).catch(() => {});
    throw err;
  }
}
