/**
 * Live model discovery for providers that advertise a runtime catalog.
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
import { parse as parseYaml } from 'yaml';
import path from 'node:path';
import { moxxyHome } from '@moxxy/sdk/server';
import { discoverLocalModels } from '@moxxy/plugin-provider-local';
import { openAICompatModelsURL } from '@moxxy/plugin-provider-openai';
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

interface ProviderItem {
  readonly model: string | null;
  readonly config: Record<string, unknown>;
}

async function readProviderItem(
  providerName: string,
): Promise<ProviderItem> {
  try {
    const body = await readFile(path.join(moxxyHome(), 'config.yaml'), 'utf8');
    const cfg = parseYaml(body) as {
      plugins?: {
        provider?: {
          items?: Record<string, { model?: unknown; config?: Record<string, unknown> }>;
        };
      };
    } | null;
    const item = cfg?.plugins?.provider?.items?.[providerName];
    return {
      model: typeof item?.model === 'string' ? item.model : null,
      config: item?.config ?? {},
    };
  } catch {
    return { model: null, config: {} };
  }
}

/**
 * Read the admin-registered vendors from the unified config
 * (`plugins.provider.items.<name>.config.kind === 'openai-compat'`) —
 * the tree that replaced ~/.moxxy/providers.json. Parsed directly with
 * `yaml` (same pattern as onboarding.ts) so the Electron main never
 * imports @moxxy/config.
 */
async function readStoredProviders(): Promise<StoredProvidersConfig> {
  try {
    const p = path.join(moxxyHome(), 'config.yaml');
    const body = await readFile(p, 'utf8');
    const cfg = parseYaml(body) as {
      plugins?: {
        provider?: {
          items?: Record<
            string,
            { model?: string; config?: Record<string, unknown> | undefined }
          >;
        };
      };
    } | null;
    const plugins = cfg?.plugins;
    const provider = plugins?.provider;
    const items = provider?.items ?? {};
    const providers: StoredProvider[] = [];
    for (const [name, item] of Object.entries(items)) {
      const c = item?.config;
      if (!c || c['kind'] !== 'openai-compat') continue;
      const models = Array.isArray(c['models'])
        ? (c['models'] as Array<{ id?: unknown }>).filter(
            (m): m is { id: string } => typeof m?.id === 'string',
          )
        : [];
      const defaultModel =
        typeof item.model === 'string' ? item.model : models[0]?.id;
      if (typeof c['baseURL'] !== 'string' || !defaultModel) continue;
      providers.push({
        kind: 'openai-compat',
        name,
        baseURL: c['baseURL'],
        defaultModel,
        models,
        ...(typeof c['envVar'] === 'string' ? { envVar: c['envVar'] } : {}),
      });
    }
    return { providers };
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
 * The built-in local provider owns its unauthenticated discovery behavior;
 * admin-registered providers use their stored endpoint and vault credential.
 * Other built-ins keep their runner-advertised catalog and return no additions.
 */
export async function fetchProviderModels(
  providerName: string,
  options: { readonly signal?: AbortSignal } = {},
): Promise<ReadonlyArray<string>> {
  if (providerName === 'local') {
    const { config } = await readProviderItem(providerName);
    const baseURL = typeof config['baseURL'] === 'string' ? config['baseURL'] : undefined;
    return discoverLocalModels(
      baseURL ? { baseURL } : {},
      options.signal ? { signal: options.signal } : {},
    );
  }
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
  const url = openAICompatModelsURL(base);
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
    },
    signal: options.signal ?? AbortSignal.timeout(MODELS_FETCH_TIMEOUT_MS),
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

export function requireAvailableLocalModel(
  configuredModel: string | null,
  availableModels: ReadonlyArray<string>,
): string {
  if (!configuredModel) {
    throw new Error(
      'Choose an available local model before sending a message. Open Model & usage and select one from Ollama.',
    );
  }
  if (!availableModels.includes(configuredModel)) {
    throw new Error(
      `Configured local model "${configuredModel}" is not available from Ollama. ` +
        'Open Model & usage and choose one of the currently available models.',
    );
  }
  return configuredModel;
}

/** Resolve a safe local default only when the configured id is currently live. */
export async function resolveLocalModelForTurn(): Promise<string> {
  const item = await readProviderItem('local');
  const baseURL = typeof item.config['baseURL'] === 'string'
    ? item.config['baseURL']
    : undefined;
  const models = await discoverLocalModels(baseURL ? { baseURL } : {});
  return requireAvailableLocalModel(item.model, models);
}

/** Reachability probe used by Settings; a model list may legitimately be empty. */
export async function isProviderModelServerConnected(providerName: string): Promise<boolean> {
  try {
    await fetchProviderModels(providerName, { signal: AbortSignal.timeout(2_000) });
    return true;
  } catch {
    return false;
  }
}
