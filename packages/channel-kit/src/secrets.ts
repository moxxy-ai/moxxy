/** The read slice of the vault a channel secret lookup needs. */
export interface SecretReader {
  get(name: string): Promise<string | null>;
}

export interface SecretSpec {
  /** Env override — beats the vault, matching every channel's precedence. */
  readonly envVar?: string;
  /** Vault key the channel stores the secret under. */
  readonly vaultKey: string;
}

/**
 * Resolve a channel secret: env override first, then the vault. Values are
 * trimmed and empty strings are treated as unset (an env var set to whitespace
 * falls through to the vault rather than masking it). Returns null when
 * neither source has a value.
 */
export async function resolveSecret(vault: SecretReader, spec: SecretSpec): Promise<string | null> {
  if (spec.envVar) {
    const fromEnv = process.env[spec.envVar]?.trim();
    if (fromEnv) return fromEnv;
  }
  const stored = (await vault.get(spec.vaultKey))?.trim();
  return stored || null;
}
