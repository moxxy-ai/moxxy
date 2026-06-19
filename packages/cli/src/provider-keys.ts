import type { VaultStore } from '@moxxy/plugin-vault';
import { providerApiKeyName } from '@moxxy/plugin-provider-admin';
import { MoxxyError } from '@moxxy/sdk';
import * as readline from 'node:readline/promises';

/**
 * Canonical vault entry name + env var name for a provider's API key. Both
 * the vault and the env-var fallback use the same name, so a user with the
 * env set doesn't have to mirror it. Delegates to the ONE shared derivation
 * in `@moxxy/plugin-provider-admin` (upper-snake slug + `_API_KEY`) so the
 * CLI, the admin tools and the desktop all agree on the name. For
 * runtime-registered providers with a stored `envVar` override, resolve it
 * via `resolveProviderCredentials`, which passes the override through
 * `ResolveOptions.keyName`.
 */
export function canonicalKey(providerName: string): string {
  return providerApiKeyName(providerName);
}

/**
 * Vendor-doc env-var aliases consulted (in order) when the canonical
 * `<NAME>_API_KEY` is NOT set in the environment. Some providers' own docs hand
 * users a differently-named variable than moxxy's canonical one — e.g. Google AI
 * Studio (Gemini) tells users to export `GEMINI_API_KEY`, but moxxy resolves the
 * google provider under `GOOGLE_API_KEY`. Honoring the alias means a user who
 * followed the vendor's own setup just works, without having to mirror the key.
 *
 * Keyed by the canonical name so it stays provider-agnostic; the canonical value
 * always wins (this is only a fallback for a *missing* canonical). Aliases are
 * never written to the vault — only the canonical name is persisted on prompt.
 */
const ENV_ALIASES: Readonly<Record<string, ReadonlyArray<string>>> = {
  GOOGLE_API_KEY: ['GEMINI_API_KEY'],
};

/** First non-empty env-var alias value for `canonical`, or undefined. */
function resolveEnvAlias(canonical: string): string | undefined {
  for (const alias of ENV_ALIASES[canonical] ?? []) {
    const v = process.env[alias];
    if (v) return v;
  }
  return undefined;
}

export interface ResolveOptions {
  /** Already-merged provider config. If apiKey is set, we trust it. */
  readonly providerConfig?: Record<string, unknown>;
  /**
   * Override the vault/env key name. Used for runtime-registered providers
   * whose stored `envVar` differs from the canonical `<NAME>_API_KEY`.
   */
  readonly keyName?: string;
  /** Allow interactive prompts when the key isn't found anywhere. */
  readonly interactive?: boolean;
  /** Custom label to show in the prompt. */
  readonly promptLabel?: string;
  /** Persist a prompted answer to the vault. Default true. */
  readonly persistToVault?: boolean;
  /** Custom prompt function for tests. */
  readonly promptFn?: (label: string) => Promise<string>;
}

export interface ResolveResult {
  readonly source: 'config' | 'vault' | 'env' | 'prompt';
  readonly providerConfig: Record<string, unknown>;
  readonly canonicalName: string;
}

/**
 * Resolve a provider's API key in order: existing config → vault → env →
 * interactive prompt (TTY only). When prompted, persist the answer to the
 * vault so future runs don't ask again.
 */
export async function resolveProviderApiKey(
  providerName: string,
  vault: VaultStore,
  opts: ResolveOptions = {},
): Promise<ResolveResult> {
  const config = { ...(opts.providerConfig ?? {}) };
  const canonical = opts.keyName ?? canonicalKey(providerName);

  if (config.apiKey) {
    return { source: 'config', providerConfig: config, canonicalName: canonical };
  }

  try {
    const fromVault = await vault.get(canonical);
    if (fromVault) {
      config.apiKey = fromVault;
      return { source: 'vault', providerConfig: config, canonicalName: canonical };
    }
  } catch {
    // Vault couldn't open — fall through to env.
  }

  // Canonical name first, then any vendor-doc alias (e.g. GEMINI_API_KEY for the
  // google provider) — so a user who exported the name the provider's own docs
  // gave them is honored without having to mirror it under the canonical name.
  const fromEnv = process.env[canonical] ?? resolveEnvAlias(canonical);
  if (fromEnv) {
    config.apiKey = fromEnv;
    return { source: 'env', providerConfig: config, canonicalName: canonical };
  }

  // Only prompt when we can actually read a line: an explicit `promptFn` (tests
  // / custom callers) or a real TTY. A forced `interactive: true` in a piped /
  // daemon context with no `promptFn` would otherwise wedge `readline.question`
  // forever on a closed stdin — fall through to AUTH_NO_CREDENTIALS instead.
  const canPrompt = opts.promptFn !== undefined || process.stdin.isTTY === true;
  if ((opts.interactive ?? process.stdin.isTTY) && canPrompt) {
    const prompt = opts.promptFn ?? defaultPrompt;
    const label = opts.promptLabel ?? `${canonical}: `;
    const value = (await prompt(label)).trim();
    if (!value) {
      throw new MoxxyError({
        code: 'AUTH_NO_CREDENTIALS',
        message: `No ${canonical} provided at the prompt.`,
        hint: `Set ${canonical} as an environment variable, or run \`moxxy init\` to store it in the vault.`,
        context: { provider: providerName, env_var: canonical },
      });
    }
    config.apiKey = value;
    if (opts.persistToVault !== false) {
      try {
        await vault.set(canonical, value, [providerName]);
      } catch {
        // Vault write failed — key still usable this session.
      }
    }
    return { source: 'prompt', providerConfig: config, canonicalName: canonical };
  }

  throw new MoxxyError({
    code: 'AUTH_NO_CREDENTIALS',
    message: `No API key found for provider '${providerName}'.`,
    hint:
      `Set the ${canonical} environment variable, store it in the vault, or ` +
      `run \`moxxy init\` in an interactive terminal to be prompted.`,
    context: { provider: providerName, env_var: canonical },
  });
}

async function defaultPrompt(label: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  try {
    // `rl.question` never settles if stdin reaches EOF mid-prompt; race it
    // against the interface 'close' event so an EOF resolves to '' (→ the
    // caller throws AUTH_NO_CREDENTIALS) instead of wedging the boot path.
    return await Promise.race([
      rl.question(label),
      new Promise<string>((resolve) => rl.once('close', () => resolve(''))),
    ]);
  } finally {
    rl.close();
  }
}
