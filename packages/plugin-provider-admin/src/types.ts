import type { ModelDescriptor } from '@moxxy/sdk';

/**
 * Persisted entry for a user-registered LLM provider. Lives in
 * ~/.moxxy/providers.json and is re-read on every boot to re-register
 * the provider against the in-process registry.
 *
 * Phase 1 only supports `openai-compat` — i.e. vendors that speak the
 * OpenAI Chat Completions wire protocol (z.ai, deepseek, groq,
 * openrouter, fireworks, together, mistral, …). The host wraps the
 * shared `@moxxy/plugin-provider-openai` client with the vendor's
 * `baseURL`, so we don't reimplement streaming for each new vendor.
 *
 * Future kinds (e.g. `anthropic-compat`, native vendor SDKs) extend the
 * discriminated union; the rest of the pipeline (store + onInit) is
 * agnostic so they slot in without touching the persistence layer.
 */
export interface StoredProviderOpenAICompat {
  readonly kind: 'openai-compat';
  /** Provider name (slug). Becomes the registry key + canonical vault entry stem. */
  readonly name: string;
  /** Vendor base URL, e.g. `https://api.z.ai/api/coding/paas/v4`. */
  readonly baseURL: string;
  /** Model id used when the request didn't pin one explicitly. */
  readonly defaultModel: string;
  /** Models the vendor exposes. Powers `/model` autocomplete + the setup wizard. */
  readonly models: ReadonlyArray<ModelDescriptor>;
  /** Optional vendor-supplied env var name for the API key (defaults to `<NAME>_API_KEY`). */
  readonly envVar?: string;
  /** ISO timestamp the entry was written. Informational only. */
  readonly createdAt?: string;
}

export type StoredProvider = StoredProviderOpenAICompat;

export interface StoredProvidersConfig {
  readonly providers: ReadonlyArray<StoredProvider>;
}
