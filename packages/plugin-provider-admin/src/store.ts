import {
  defaultUserConfigPath,
  loadProviderItems,
  removeProviderItem,
  setProviderItemConfig,
  type ProviderItemState,
} from '@moxxy/config';
import { z } from '@moxxy/sdk';
import type { StoredProvider, StoredProvidersConfig } from './types.js';

/**
 * Runtime-registered (OpenAI-compatible) vendors now live in the unified
 * `plugins:` tree at `plugins.provider.items.<name>` in the USER config —
 * `config` carries the vendor payload (`kind: 'openai-compat'`, baseURL,
 * models, envVar, createdAt), `model` the default model. This REPLACED the
 * legacy `~/.moxxy/providers.json` side-store (clean-slate, no migration:
 * re-add custom vendors via `provider_add` / the desktop sheet). The
 * exported API is unchanged, so the admin tools, the runner's
 * `provider.configure`, and the desktop settings sheet all moved with it.
 */

const storedModelSchema = z
  .object({
    id: z.string().min(1),
    contextWindow: z.number(),
    // ModelDescriptor declares these as REQUIRED booleans; default them so a
    // hand-edited entry round-trips into a complete descriptor instead of
    // reaching buildProviderDef with `undefined`.
    supportsTools: z.boolean().default(true),
    supportsStreaming: z.boolean().default(true),
  })
  .passthrough();

/** The `config` payload persisted under `plugins.provider.items.<name>.config`. */
const storedItemConfigSchema = z
  .object({
    kind: z.literal('openai-compat'),
    baseURL: z.string().min(1),
    models: z.array(storedModelSchema),
    envVar: z.string().optional(),
    createdAt: z.string().optional(),
  })
  .passthrough();

function itemToStored(name: string, item: ProviderItemState): StoredProvider | null {
  const parsed = storedItemConfigSchema.safeParse(item.config ?? {});
  if (!parsed.success) return null;
  const { kind, baseURL, models, envVar, createdAt, ...rest } = parsed.data;
  const defaultModel =
    item.model ?? (typeof models[0]?.id === 'string' ? models[0].id : undefined);
  if (!defaultModel) return null;
  return {
    ...rest,
    kind,
    name,
    baseURL,
    defaultModel,
    models,
    ...(envVar ? { envVar } : {}),
    ...(createdAt ? { createdAt } : {}),
  } as unknown as StoredProvider;
}

/** The file stored vendors persist into — now the unified user config. */
export function providersConfigPath(): string {
  return defaultUserConfigPath();
}

export async function readProvidersConfig(configPath?: string): Promise<StoredProvidersConfig> {
  const items = await loadProviderItems(configPath ? { configPath } : {});
  const providers: StoredProvider[] = [];
  for (const [name, item] of Object.entries(items)) {
    const stored = itemToStored(name, item);
    if (stored) providers.push(stored);
  }
  return { providers };
}

export async function upsertStoredProvider(
  entry: StoredProvider,
  configPath?: string,
): Promise<StoredProvidersConfig> {
  const { name, defaultModel, ...payload } = entry;
  await setProviderItemConfig(name, payload as Record<string, unknown>, {
    model: defaultModel,
    ...(configPath ? { configPath } : {}),
  });
  return readProvidersConfig(configPath);
}

export async function removeStoredProvider(name: string, configPath?: string): Promise<boolean> {
  // Only remove entries that ARE stored vendors — a built-in provider's item
  // (model/enabled prefs) must survive a mistaken provider_remove.
  const opts = configPath ? { configPath } : {};
  const items = await loadProviderItems(opts);
  const item = items[name];
  if (!item || !storedItemConfigSchema.safeParse(item.config ?? {}).success) return false;
  return removeProviderItem(name, opts);
}
