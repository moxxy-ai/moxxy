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

import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { resolveMoxxyCli, augmentedPaths, spawnCli } from './cli-resolver';

/** Bound the live `/v1/models` request so a hung provider can't wedge the
 *  IPC handler (and the Settings model picker) indefinitely. */
const MODELS_FETCH_TIMEOUT_MS = 15_000;

/**
 * The vault API key is about to ride on this baseURL's request — only attach it
 * over `https:` (or http to localhost, for self-hosted dev endpoints). A
 * `http://<remote>` or internal-IP baseURL (a poisoned providers.json could set
 * one) would otherwise leak the bearer token in cleartext / to an SSRF target.
 */
function assertSafeProviderBase(base: string): void {
  let parsed: URL;
  try {
    parsed = new URL(base);
  } catch {
    throw new Error(`Invalid provider baseURL: ${base}`);
  }
  const host = parsed.hostname.toLowerCase();
  const isLocalhost = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  if (parsed.protocol === 'https:' || (parsed.protocol === 'http:' && isLocalhost)) {
    return;
  }
  throw new Error(
    `Refusing to send the API key to a non-https provider endpoint (${base}). ` +
      'Use an https:// baseURL (http is allowed only for localhost).',
  );
}

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
 * Names of the admin-registered (OpenAI-compat) providers in
 * providers.json. The single reader behind the settings dropdown / catalog —
 * tolerant of a missing or malformed file (returns []).
 */
export async function readAdminProviderNames(): Promise<string[]> {
  const { providers } = await readStoredProviders();
  return providers.map((p) => p.name).filter((n): n is string => typeof n === 'string');
}

/** Display detail of one stored admin provider for the Settings tab. */
export interface AdminProviderDetail {
  readonly name: string;
  readonly baseURL: string;
  readonly defaultModel: string;
  readonly modelIds: ReadonlyArray<string>;
  /** Vault entry name holding the API key (`envVar` override or `<NAME>_API_KEY`). */
  readonly keyName: string;
}

/**
 * Stored admin-provider entries keyed by name, for merging configure-relevant
 * detail (baseURL/defaultModel/models/keyName) into `settings.providers`.
 */
export async function readAdminProviderDetails(): Promise<Map<string, AdminProviderDetail>> {
  const { providers } = await readStoredProviders();
  const out = new Map<string, AdminProviderDetail>();
  for (const p of providers) {
    if (typeof p.name !== 'string') continue;
    out.set(p.name, {
      name: p.name,
      baseURL: p.baseURL,
      defaultModel: p.defaultModel,
      modelIds: (p.models ?? []).map((m) => m.id).filter((id): id is string => typeof id === 'string'),
      keyName: envVarFor(p),
    });
  }
  return out;
}

/**
 * Vault entry name for a BUILT-IN provider's API key — the same
 * `<NAME>_API_KEY` derivation `saveProviderKey` (onboarding) and the CLI's
 * credential resolver use.
 */
export function builtinProviderKeyName(providerName: string): string {
  return `${providerName.toUpperCase().replace(/-/g, '_')}_API_KEY`;
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
    const child = spawnCli(cli, ['vault', 'get', key]);
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (b) => {
      stdout += b.toString();
    });
    child.stderr?.on('data', (b) => {
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
  return provider.envVar ?? builtinProviderKeyName(provider.name);
}

/**
 * Fetch the model list from a provider's `/v1/models`. Works for any
 * OpenAI-compatible API (OpenAI, OpenRouter, Together, zai, etc.).
 * Returns ids sorted alphabetically.
 *
 * Built-in providers (anthropic, openai, openai-codex) ship their
 * own hard-coded model list with the moxxy CLI build and don't need
 * live discovery — we return an empty array and let the picker fall
 * back to whatever the runner advertises, rather than throwing.
 */
export async function fetchProviderModels(
  providerName: string,
): Promise<ReadonlyArray<string>> {
  const stored = await readStoredProviders();
  const entry = stored.providers.find((p) => p.name === providerName);
  if (!entry) {
    // Not in providers.json → almost certainly a built-in. The runner
    // already has its model list cached and surfaced via session.info,
    // so an empty result here means "we have nothing extra to add",
    // which is the truth. The caller merges with advertised models.
    return [];
  }
  const base = entry.baseURL.replace(/\/+$/, '');
  // Validate the endpoint BEFORE decrypting/attaching the key so a poisoned
  // baseURL can't even trigger the vault read.
  assertSafeProviderBase(base);
  const apiKey = await vaultGet(envVarFor(entry));
  const url = `${base}/v1/models`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(MODELS_FETCH_TIMEOUT_MS),
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
