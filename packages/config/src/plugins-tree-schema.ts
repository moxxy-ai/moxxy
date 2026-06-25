import { z } from 'zod';
import { pluginSettingsSchema } from './plugin-settings-schema.js';

/**
 * The unified `plugins:` tree — the single source of truth for what's
 * installed/enabled and what's the active default per category. Two axes:
 *
 *   - `packages` — the install/enable ledger, keyed by **npm package name**.
 *     Enabling a package makes all of its contributions available at once.
 *   - per-category slots — the swap axis, keyed by **contribution name**
 *     (`provider.default: anthropic`). The no-package core floors
 *     (markdown/localhost/tfidf/jsonl/none) can only be named this way, and a
 *     multi-contribution package needs to say *which* one is active. A package
 *     name is also accepted as a `default` alias and resolved to its sole
 *     contribution of the kind (ambiguous when the package contributes several).
 *
 * Clean slate: this fully replaces the legacy flat `provider`/`mode`/`compactor`/
 * `workflowExecutor` keys, the old package-keyed `plugins:` map, and
 * `preferences.json`. There is no back-compat normalizer.
 */

/** Per-item options for a provider contribution. */
export const providerItemSchema = z
  .object({
    /** Default model id for this provider. */
    model: z.string().optional(),
    /** Provider-specific client config (baseURL, headers, …). */
    config: z.record(z.string(), z.unknown()).optional(),
    /** Disable this specific provider contribution without removing the package. */
    enabled: z.boolean().optional(),
  })
  .strict();
export type ProviderItem = z.infer<typeof providerItemSchema>;

/** The provider category slot (special: ordered credential fallbacks + typed items). */
export const providerSlotSchema = z
  .object({
    /** Active provider contribution name (or a package-name alias). */
    default: z.string().optional(),
    /** Ordered provider names to fall back to when the primary's key fails. */
    fallbacks: z.array(z.string()).optional(),
    items: z.record(z.string(), providerItemSchema).optional(),
  })
  .strict();
export type ProviderSlot = z.infer<typeof providerSlotSchema>;

/** A generic active-def category slot: which contribution is the default + per-item options. */
export const categorySlotSchema = z
  .object({
    /** Active contribution name (or a package-name alias). */
    default: z.string().optional(),
    /** Per-contribution option bags, keyed by contribution name. */
    items: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
  })
  .strict();
export type CategorySlot = z.infer<typeof categorySlotSchema>;

/**
 * The `plugins:` tree. Reserved keys = `packages` + the active-def category
 * names; the schema is closed (`.strict()`) so a typo'd key is a clear error
 * rather than a silently-ignored setting.
 */
export const pluginsTreeSchema = z
  .object({
    /** Install/enable ledger keyed by npm package name. */
    packages: z.record(z.string(), pluginSettingsSchema).optional(),
    // Swap axis — one slot per ActiveDef registry kind.
    provider: providerSlotSchema.optional(),
    mode: categorySlotSchema.optional(),
    compactor: categorySlotSchema.optional(),
    cacheStrategy: categorySlotSchema.optional(),
    workflowExecutor: categorySlotSchema.optional(),
    transcriber: categorySlotSchema.optional(),
    synthesizer: categorySlotSchema.optional(),
    embedder: categorySlotSchema.optional(),
    isolator: categorySlotSchema.optional(),
    viewRenderer: categorySlotSchema.optional(),
    tunnelProvider: categorySlotSchema.optional(),
    eventStore: categorySlotSchema.optional(),
    channel: categorySlotSchema.optional(),
  })
  .strict();
export type PluginsTree = z.infer<typeof pluginsTreeSchema>;

/** The set of category keys that carry an active-def `default` (i.e. every key but `packages`). */
export const PLUGIN_CATEGORY_KEYS = [
  'provider',
  'mode',
  'compactor',
  'cacheStrategy',
  'workflowExecutor',
  'transcriber',
  'synthesizer',
  'embedder',
  'isolator',
  'viewRenderer',
  'tunnelProvider',
  'eventStore',
  'channel',
] as const;
export type PluginCategoryKey = (typeof PLUGIN_CATEGORY_KEYS)[number];
