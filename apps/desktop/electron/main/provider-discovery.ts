/**
 * Live model discovery for admin-registered providers.
 *
 * The runner exposes `SessionInfo.providers[*].models` but those lists
 * are whatever the user put in `~/.moxxy/providers.json` — typically
 * empty for OpenAI-compatible providers added via `provider_add`. To
 * give the desktop's model picker a real list we hit the provider's
 * own `/v1/models` endpoint with the auth header from the user's
 * vault.
 *
 * The vault is encrypted; we don't have its KDF here, so we shell out
 * to `moxxy vault get <ENV>` and capture stdout. The CLI is the only
 * thing that knows how to decrypt; this keeps the desktop honest
 * about the vault boundary (never reads plaintext from disk
 * directly).
 */

import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { resolveMoxxyCli, augmentedPaths } from './cli-resolver';

interface StoredProvider {
  readonly kind: 'openai-compat';
  readonly name: string;
  readonly baseURL: string;
  readonly defaultModel: string;
  readonly models: ReadonlyArray<{ id: string }>;
  readonly envVar?: string;
}

interface StoredProvidersConfig {
  readonly providers: ReadonlyArray<StoredProvider>;
}

/** Read ~/.moxxy/providers.json without depending on the plugin. */
async function readStoredProviders(): Promise<StoredProvidersConfig> {
  try {
    const p = path.join(homedir(), '.moxxy', 'providers.json');
    const body = await readFile(p, 'utf8');
    const json = JSON.parse(body) as StoredProvidersConfig;
    if (json && Array.isArray(json.providers)) return json;
  } catch {
    /* missing or malformed */
  }
  return { providers: [] };
}

/**
 * Spawn `moxxy vault get <key>` and resolve to stdout (trimmed). The
 * CLI prints the decrypted value to stdout and any UX scaffolding to
 * stderr; we drop stderr. Throws on non-zero exit.
 */
function vaultGet(key: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const cli = resolveMoxxyCli({ extraPaths: augmentedPaths() });
    if (!cli) {
      reject(new Error('moxxy CLI not on PATH'));
      return;
    }
    const child =
      cli.kind === 'direct'
        ? spawn(cli.bin, ['vault', 'get', key], {
            stdio: ['ignore', 'pipe', 'pipe'],
          })
        : spawn('node', [cli.entry, 'vault', 'get', key], {
            stdio: ['ignore', 'pipe', 'pipe'],
          });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (b) => {
      stdout += b.toString();
    });
    child.stderr.on('data', (b) => {
      stderr += b.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(`moxxy vault get ${key} exited ${code}: ${stderr.trim()}`));
      }
    });
  });
}

/**
 * Resolve the env-var name a stored OpenAI-compat provider uses for
 * its auth token. The provider-admin convention is `<NAME>_API_KEY`
 * unless the user overrode `envVar` when adding it.
 */
function envVarFor(provider: StoredProvider): string {
  return (
    provider.envVar ??
    `${provider.name.toUpperCase().replace(/-/g, '_')}_API_KEY`
  );
}

/**
 * Fetch the model list from a provider's `/v1/models`. Works for any
 * OpenAI-compatible API (OpenAI, OpenRouter, Together, zai, etc.).
 * Returns ids sorted alphabetically.
 */
export async function fetchProviderModels(
  providerName: string,
): Promise<ReadonlyArray<string>> {
  const stored = await readStoredProviders();
  const entry = stored.providers.find((p) => p.name === providerName);
  if (!entry) {
    throw new Error(
      `provider "${providerName}" is not registered in providers.json — ` +
        `live model discovery is only wired for admin-registered providers`,
    );
  }
  const apiKey = await vaultGet(envVarFor(entry));
  const base = entry.baseURL.replace(/\/+$/, '');
  const url = `${base}/v1/models`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
    },
  });
  if (!res.ok) {
    throw new Error(`GET ${url} → ${res.status} ${res.statusText}`);
  }
  const body = (await res.json()) as { data?: ReadonlyArray<{ id?: string }> };
  const ids = (body.data ?? [])
    .map((m) => m.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
  return ids.sort();
}
