import type {
  EmbeddingsConfig,
  MoxxyConfig,
  PluginCategoryKey,
  ProviderItem,
  ProviderSlot,
} from '@moxxy/config';

/**
 * Read accessors over the unified `plugins:` manifest. The single place that
 * knows the tree's shape and the built-in default contribution names, so
 * readers (setup, config-applier, doctor, the apply loop) don't re-walk it.
 *
 * Clean slate: there is no legacy-key folding — these read `config.plugins`
 * directly.
 */

/** Built-in default contribution name per category, used when a slot omits `default`. */
const BUILTIN_DEFAULTS: Partial<Record<PluginCategoryKey, string>> = {
  mode: 'default',
  compactor: 'summarize',
  cacheStrategy: 'stable-prefix',
  workflowExecutor: 'dag',
  embedder: 'tfidf',
  isolator: 'none',
  viewRenderer: 'markdown',
  tunnelProvider: 'localhost',
  eventStore: 'jsonl',
};

/** The provider slot, or an empty slot when unset. */
export function providerSlot(config: MoxxyConfig): ProviderSlot {
  return config.plugins?.provider ?? {};
}

/** The active provider contribution name (defaults to `anthropic`). */
export function providerDefault(config: MoxxyConfig): string {
  return config.plugins?.provider?.default ?? 'anthropic';
}

/** Per-item options (model/config) for a provider, defaulting to the active one. */
export function providerItem(config: MoxxyConfig, name?: string): ProviderItem {
  const slot = providerSlot(config);
  const key = name ?? slot.default ?? 'anthropic';
  return slot.items?.[key] ?? {};
}

/**
 * The configured default contribution name for an active-def category, falling
 * back to the built-in default. Returns undefined for categories without a
 * built-in default (transcriber/synthesizer/channel) when unset.
 */
export function categoryDefault(config: MoxxyConfig, key: PluginCategoryKey): string | undefined {
  return config.plugins?.[key]?.default ?? BUILTIN_DEFAULTS[key];
}

/** Per-package settings from the install/enable ledger. */
export function packageSettings(config: MoxxyConfig, pkg: string) {
  return config.plugins?.packages?.[pkg];
}

/** Package names explicitly disabled (`enabled: false`) in the ledger. */
export function disabledPackageNames(config: MoxxyConfig): string[] {
  return Object.entries(config.plugins?.packages ?? {})
    .filter(([, settings]) => settings?.enabled === false)
    .map(([name]) => name);
}

/**
 * Map the `plugins.embedder` slot onto the flat {@link EmbeddingsConfig} that
 * {@link selectEmbedder} consumes. `default` is the embedder contribution name
 * (`tfidf`/`openai`/`transformers`/`none`); the model/dimensions/apiKey/etc.
 * come from that item's option bag. Returns undefined when no embedder slot is
 * configured (selectEmbedder then defaults to TF-IDF).
 */
export function embedderSelection(config: MoxxyConfig): EmbeddingsConfig | undefined {
  const slot = config.plugins?.embedder;
  if (!slot || (!slot.default && !slot.items)) return undefined;
  const provider = (slot.default ?? 'tfidf') as EmbeddingsConfig['provider'];
  const item = (slot.default ? slot.items?.[slot.default] : undefined) ?? {};
  const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
  const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);
  const bool = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined);
  return {
    provider,
    model: str(item.model),
    dimensions: num(item.dimensions),
    apiKey: str(item.apiKey),
    batchSize: num(item.batchSize),
    cacheDir: str(item.cacheDir),
    persistIndex: bool(item.persistIndex),
  };
}
