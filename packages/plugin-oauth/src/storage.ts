import type { VaultStore } from '@moxxy/plugin-vault';
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
 *
 * Provider names are namespaced with a `/` so the vault's `list-by-tag`
 * UI groups them. Provider names MUST be `[a-z0-9._-]+`; the schema in
 * the tool layer enforces this.
 */
const PROVIDER_RE = /^[a-z0-9._-]+$/;

export function validateProvider(name: string): void {
  if (!PROVIDER_RE.test(name)) {
    throw new Error(
      `oauth provider name "${name}" must match ${PROVIDER_RE.source} (lowercase, digits, ._-)`,
    );
  }
}

export interface StoredCreds {
  readonly tokenSet: TokenSet;
  readonly clientId: string;
  readonly clientSecret: string | null;
  readonly tokenUrl: string;
}

export async function storeTokenSet(
  vault: VaultStore,
  provider: string,
  tokens: TokenSet,
  setupMeta: { clientId: string; clientSecret?: string; tokenUrl: string },
): Promise<void> {
  validateProvider(provider);
  const tag = `oauth:${provider}`;
  const base = `oauth/${provider}`;
  await vault.set(`${base}/access_token`, tokens.accessToken, [tag]);
  if (tokens.refreshToken !== undefined) {
    await vault.set(`${base}/refresh_token`, tokens.refreshToken, [tag]);
  }
  if (tokens.expiresAt !== undefined) {
    await vault.set(`${base}/expires_at`, String(tokens.expiresAt), [tag]);
  }
  if (tokens.scope !== undefined) {
    await vault.set(`${base}/scope`, tokens.scope, [tag]);
  }
  await vault.set(`${base}/token_type`, tokens.tokenType, [tag]);
  if (tokens.idToken !== undefined) {
    await vault.set(`${base}/id_token`, tokens.idToken, [tag]);
  }
  await vault.set(`${base}/client_id`, setupMeta.clientId, [tag]);
  if (setupMeta.clientSecret) {
    await vault.set(`${base}/client_secret`, setupMeta.clientSecret, [tag]);
  }
  await vault.set(`${base}/token_url`, setupMeta.tokenUrl, [tag]);
}

export async function readStoredCreds(
  vault: VaultStore,
  provider: string,
): Promise<StoredCreds | null> {
  validateProvider(provider);
  const base = `oauth/${provider}`;
  const access = await vault.get(`${base}/access_token`);
  if (!access) return null;
  const refresh = await vault.get(`${base}/refresh_token`);
  const expiresStr = await vault.get(`${base}/expires_at`);
  const scope = await vault.get(`${base}/scope`);
  const tokenType = (await vault.get(`${base}/token_type`)) ?? 'Bearer';
  const idToken = await vault.get(`${base}/id_token`);
  const clientId = await vault.get(`${base}/client_id`);
  const clientSecret = await vault.get(`${base}/client_secret`);
  const tokenUrl = await vault.get(`${base}/token_url`);
  if (!clientId || !tokenUrl) {
    // Missing setup-meta means a partial store — refresh impossible. Treat as absent.
    return null;
  }
  return {
    tokenSet: {
      accessToken: access,
      ...(refresh !== null ? { refreshToken: refresh } : {}),
      ...(expiresStr !== null ? { expiresAt: Number.parseInt(expiresStr, 10) } : {}),
      ...(scope !== null ? { scope } : {}),
      tokenType,
      ...(idToken !== null ? { idToken } : {}),
    },
    clientId,
    clientSecret,
    tokenUrl,
  };
}

export async function clearStoredCreds(vault: VaultStore, provider: string): Promise<number> {
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
  ];
  let removed = 0;
  for (const k of keys) {
    if (await vault.delete(k)) removed += 1;
  }
  return removed;
}

/** True when the access token has expired (or is within `skewMs` of doing so). */
export function isExpired(tokens: TokenSet, skewMs = 60_000): boolean {
  if (tokens.expiresAt === undefined) return false;
  return Date.now() + skewMs >= tokens.expiresAt;
}
