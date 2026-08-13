/**
 * Where a named secret comes from: a swappable block, like every other.
 *
 * The built-in vault (AES-256-GCM under `~/.moxxy/vault.json`, unlocked via the
 * OS keychain) is a good design for one machine and unusable for a fleet: there
 * is no central issuance, no rotation, and no way to revoke a single
 * workstation. Every organisation already runs something that does those three
 * things, so the answer is to let them plug it in rather than to reimplement it.
 *
 * Deliberately ONE block rather than two. A host-scoped credential (a token for
 * an internal registry or a GitHub Enterprise host) is a named secret with a
 * naming convention on top; splitting it into a second `CredentialProvider`
 * registry would leave two overlapping abstractions to keep in sync for no
 * gain.
 */

export interface SecretProviderScope {
  readonly cwd: string;
}

export interface SecretProviderSession {
  /**
   * Resolve a secret by name, or null when this provider does not hold it.
   *
   * Returning null rather than throwing is what makes providers composable: the
   * host tries the active provider and falls back to the local vault, so
   * adopting an external store does not require migrating every secret on day
   * one.
   *
   * MUST NOT throw for an ordinary miss. A genuine failure (the store is
   * unreachable, the token expired) SHOULD throw, because silently reporting
   * "no such secret" for an outage would send the caller down a
   * missing-credential path and hide the real cause.
   */
  get(name: string): Promise<string | null>;
  close(): Promise<void>;
}

export interface SecretProviderDef {
  readonly name: string;
  readonly description?: string;
  open(scope: SecretProviderScope): SecretProviderSession;
}

/** Freeze a secret-provider spec, mirroring the other `defineX` factories. */
export function defineSecretProvider(def: SecretProviderDef): SecretProviderDef {
  return Object.freeze({ ...def });
}

/**
 * The canonical secret name holding a credential for `host`.
 *
 * A host credential is a named secret plus a convention, which is exactly why
 * there is no separate `CredentialProvider` registry: whatever store an
 * organisation already plugged in for secrets serves these too.
 *
 * `github.example.com` becomes `MOXXY_CREDENTIAL_GITHUB_EXAMPLE_COM`. The
 * derivation mirrors the provider-key convention (upper-snake, non-alphanumerics
 * to `_`) so an operator who has seen one can predict the other, and a port is
 * dropped because a credential belongs to the host, not to a socket.
 *
 * Accepts a bare host or a full URL; anything unparseable yields null rather
 * than a name derived from garbage, so a caller cannot accidentally look up a
 * secret keyed on a typo.
 */
export function hostCredentialName(hostOrUrl: string): string | null {
  const raw = hostOrUrl.trim();
  if (raw.length === 0) return null;
  let host = raw;
  if (raw.includes('://')) {
    try {
      host = new URL(raw).hostname;
    } catch {
      return null;
    }
  } else {
    // Strip a port or a path if the caller passed `host:443/x`.
    host = raw.split('/')[0]!.split(':')[0]!;
  }
  host = host.replace(/^\[|\]$/g, '').trim();
  if (host.length === 0 || /\s/.test(host)) return null;
  const slug = host.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return slug.length > 0 ? `MOXXY_CREDENTIAL_${slug}` : null;
}
