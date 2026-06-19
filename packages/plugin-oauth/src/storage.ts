import type { TokenSet } from './flow.js';

/**
 * Vault key convention:
 *   oauth/<provider>/access_token
 *   oauth/<provider>/refresh_token
 *   oauth/<provider>/expires_at      (epoch ms, string)
 *   oauth/<provider>/scope
 *   oauth/<provider>/token_type
 *   oauth/<provider>/id_token        (OIDC providers only)
 *   oauth/<provider>/client_id       (so refresh doesn't need the model to re-pass it)
 *   oauth/<provider>/client_secret   (confidential clients only)
 *   oauth/<provider>/token_url       (so refresh works without re-supplying)
 *   oauth/<provider>/extras          (JSON map of provider-specific fields, e.g. account_id)
 *
 * Provider names are namespaced with a `/` so the vault's `list-by-tag`
 * UI groups them. Provider names MUST be `[a-z0-9._-]+`; the schema in
 * the tool layer enforces this.
 */
const PROVIDER_RE = /^[a-z0-9._-]+$/;

/**
 * Minimal vault shape this module uses. Both `@moxxy/plugin-vault`'s
 * `VaultStore` and the SDK's `ProviderVault` structurally satisfy it, so
 * callers can pass whichever they hold.
 */
export interface OAuthVault {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, tags?: ReadonlyArray<string>): Promise<void>;
  delete?(key: string): Promise<boolean>;
}

export function validateProvider(name: string): void {
  if (!PROVIDER_RE.test(name)) {
    throw new Error(
      `oauth provider name "${name}" must match ${PROVIDER_RE.source} (lowercase, digits, ._-)`,
    );
  }
}

export interface StoreTokenSetMeta {
  readonly clientId: string;
  readonly clientSecret?: string;
  readonly tokenUrl: string;
  /**
   * Provider-specific extras the framework persists alongside the token
   * set. Used for fields like `account_id`, `org_id`, `team_slug` that
   * don't fit `TokenSet` but the caller wants to recover later.
   */
  readonly extras?: Readonly<Record<string, string>>;
}

export interface StoredCreds {
  readonly tokenSet: TokenSet;
  readonly clientId: string;
  readonly clientSecret: string | null;
  readonly tokenUrl: string;
  readonly extras: Readonly<Record<string, string>>;
}

export async function storeTokenSet(
  vault: OAuthVault,
  provider: string,
  tokens: TokenSet,
  meta: StoreTokenSetMeta,
): Promise<void> {
  validateProvider(provider);
  const tag = `oauth:${provider}`;
  const base = `oauth/${provider}`;
  // Write each optional field when present, but DELETE the stored key when the
  // new TokenSet omits it, so the persisted bundle exactly mirrors the live
  // TokenSet. A refresh response that omits expires_in/scope/id_token (RFC 6749
  // §5.1 permits this) must not leave a stale expires_at (which would make
  // isExpired() loop forever or trust a token off dead data) or a stale OIDC
  // id_token (which extractAccountId/extractExtras might re-derive identity
  // from). Callers preserve a rotated-or-prior refresh_token BEFORE calling us
  // (RFC 6749 §6: a refresh MAY omit refresh_token), so an undefined
  // refreshToken here genuinely means "no refresh token" — mirror that too.
  const upsert = async (key: string, value: string | undefined): Promise<void> => {
    if (value !== undefined) {
      await vault.set(`${base}/${key}`, value, [tag]);
    } else {
      await vault.delete?.(`${base}/${key}`);
    }
  };
  await vault.set(`${base}/access_token`, tokens.accessToken, [tag]);
  await upsert('refresh_token', tokens.refreshToken);
  await upsert('expires_at', tokens.expiresAt !== undefined ? String(tokens.expiresAt) : undefined);
  await upsert('scope', tokens.scope);
  await vault.set(`${base}/token_type`, tokens.tokenType, [tag]);
  await upsert('id_token', tokens.idToken);
  await vault.set(`${base}/client_id`, meta.clientId, [tag]);
  if (meta.clientSecret) {
    await vault.set(`${base}/client_secret`, meta.clientSecret, [tag]);
  }
  await vault.set(`${base}/token_url`, meta.tokenUrl, [tag]);
  if (meta.extras && Object.keys(meta.extras).length > 0) {
    await vault.set(`${base}/extras`, JSON.stringify(meta.extras), [tag]);
  }
}

export async function readStoredCreds(
  vault: OAuthVault,
  provider: string,
): Promise<StoredCreds | null> {
  validateProvider(provider);
  const base = `oauth/${provider}`;
  const access = await vault.get(`${base}/access_token`);
  if (!access) return null;
  // The remaining nine keys are independent reads with no ordering dependency;
  // ensureFreshTokens runs this before every upstream LLM call, so fetch them
  // concurrently instead of serializing ~9 vault round-trips on the hot path.
  const [refresh, expiresStr, scope, tokenTypeRaw, idToken, clientId, clientSecret, tokenUrl, extrasRaw] =
    await Promise.all([
      vault.get(`${base}/refresh_token`),
      vault.get(`${base}/expires_at`),
      vault.get(`${base}/scope`),
      vault.get(`${base}/token_type`),
      vault.get(`${base}/id_token`),
      vault.get(`${base}/client_id`),
      vault.get(`${base}/client_secret`),
      vault.get(`${base}/token_url`),
      vault.get(`${base}/extras`),
    ]);
  const tokenType = tokenTypeRaw ?? 'Bearer';
  if (!clientId || !tokenUrl) {
    // Missing setup-meta means a partial store — refresh impossible. Treat as absent.
    return null;
  }
  // A stored `expires_at` that doesn't parse to a finite number (corrupt vault
  // write, a hand-edited value, a partial flush) is poison: carried through as
  // NaN it makes `isExpired` return false (NaN comparisons are always false),
  // so the token would read as ETERNALLY fresh and never refresh — the user
  // silently keeps presenting a possibly-dead token. Drop the unparseable value
  // and let `expiresAt` go undefined; `isExpired` then defends the
  // no-known-expiry case explicitly (see below).
  const expiresAtParsed = expiresStr !== null ? Number.parseInt(expiresStr, 10) : null;
  const expiresAt =
    expiresAtParsed !== null && Number.isFinite(expiresAtParsed) ? expiresAtParsed : undefined;
  return {
    tokenSet: {
      accessToken: access,
      ...(refresh !== null ? { refreshToken: refresh } : {}),
      ...(expiresAt !== undefined ? { expiresAt } : {}),
      ...(scope !== null ? { scope } : {}),
      tokenType,
      ...(idToken !== null ? { idToken } : {}),
    },
    clientId,
    clientSecret,
    tokenUrl,
    extras: parseExtras(extrasRaw),
  };
}

export async function clearStoredCreds(vault: OAuthVault, provider: string): Promise<number> {
  validateProvider(provider);
  const base = `oauth/${provider}`;
  const keys = [
    `${base}/access_token`,
    `${base}/refresh_token`,
    `${base}/expires_at`,
    `${base}/scope`,
    `${base}/token_type`,
    `${base}/id_token`,
    `${base}/client_id`,
    `${base}/client_secret`,
    `${base}/token_url`,
    `${base}/extras`,
  ];
  let removed = 0;
  for (const k of keys) {
    if (await vault.delete?.(k)) removed += 1;
  }
  return removed;
}

/**
 * True when the access token has expired (or is within `skewMs` of doing so).
 *
 * A token with no `expiresAt` is treated as non-expiring (some providers issue
 * tokens without `expires_in`). A non-FINITE `expiresAt` (NaN/Infinity — corrupt
 * data, an out-of-range parse) is treated as EXPIRED, never as fresh: a bare
 * `>=` against NaN is always false, which would otherwise mark a token eternally
 * valid and suppress every refresh. Forcing the expired branch degrades to a
 * refresh (or a clear AUTH_EXPIRED if no refresh_token) instead of silently
 * serving a token whose real expiry is unknown.
 */
export function isExpired(tokens: TokenSet, skewMs = 60_000): boolean {
  if (tokens.expiresAt === undefined) return false;
  if (!Number.isFinite(tokens.expiresAt)) return true;
  return Date.now() + skewMs >= tokens.expiresAt;
}

function parseExtras(raw: string | null): Readonly<Record<string, string>> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'string') out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}
