import type { VaultStore } from '@moxxy/plugin-vault';
import { MoxxyError } from '@moxxy/sdk';
import * as readline from 'node:readline/promises';

/**
 * Canonical vault entry name + env var name for a provider's API key. Both
 * the vault and the env-var fallback use the same name, so a user with the
 * env set doesn't have to mirror it. Derived from the provider name; the CLI
 * is intentionally provider-agnostic (no hardcoded list).
 */
export function canonicalKey(providerName: string): string {
  return `${providerName.toUpperCase()}_API_KEY`;
}

export interface ResolveOptions {
  /** Already-merged provider config. If apiKey is set, we trust it. */
  readonly providerConfig?: Record<string, unknown>;
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
  const canonical = canonicalKey(providerName);

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

  const fromEnv = process.env[canonical];
  if (fromEnv) {
    config.apiKey = fromEnv;
    return { source: 'env', providerConfig: config, canonicalName: canonical };
  }

  if (opts.interactive ?? process.stdin.isTTY) {
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
    return await rl.question(label);
  } finally {
    rl.close();
  }
}
