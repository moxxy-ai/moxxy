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
