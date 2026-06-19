import { defineProvider, type ModelDescriptor, type ProviderAuthDescriptor, type ProviderDef } from '@moxxy/sdk';
import { OpenAIProvider, type OpenAIProviderConfig } from './provider.js';
import { validateKey as validateOpenAICompatKey } from './validate.js';

/**
 * The slice of the registry's untyped `Record<string, unknown>` config that an
 * OpenAI-compatible vendor actually forwards. The provider registry hands
 * `createClient` a `Record<string, unknown>` (resolved credentials + any
 * persisted provider config); only these three optional strings are ever
 * meaningful to the underlying {@link OpenAIProvider}, so we narrow to them.
 */
export interface OpenAICompatConfig {
  readonly apiKey?: string;
  readonly baseURL?: string;
  readonly defaultModel?: string;
}

/**
 * Narrow the registry's untyped config down to the handful of optional string
 * fields an OpenAI-compatible vendor forwards (`apiKey`/`baseURL`/`defaultModel`).
 * A blanket `config as OpenAIProviderConfig` cast would silently smuggle any
 * wrong-typed field straight through to the client; this pick keeps only
 * known-good strings so a bad value falls back to the vendor defaults instead.
 */
export function pickOpenAICompatConfig(config: Record<string, unknown>): OpenAICompatConfig {
  const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
  return {
    apiKey: str(config.apiKey),
    baseURL: str(config.baseURL),
    defaultModel: str(config.defaultModel),
  };
}

export interface DefineOpenAICompatProviderSpec {
  /**
   * Vendor slug (e.g. `xai`, `zai`, `google`, `local`). Stamped onto the
   * underlying client so usage stats, provider_request/response events and
   * error context attribute to the vendor, NOT `openai`.
   */
  readonly name: string;
  /** Vendor base URL. Config may override it (narrow string pick); else this default is used. */
  readonly baseURL: string;
  /** Default model when a request didn't pin one. Config may override it (narrow string pick). */
  readonly defaultModel: string;
  /** The vendor's model catalog, forced onto the client (so context-window/capability lookups hit the vendor's models). */
  readonly models: ReadonlyArray<ModelDescriptor>;
  /** Auth descriptor surfaced to the setup wizard / `moxxy login`. */
  readonly auth?: ProviderAuthDescriptor;
  /**
   * Key validation. When `true` (the default), wire `validateOpenAICompatKey`
   * to probe `baseURL`'s `/models`. When `false`, omit `validateKey` entirely
   * (local servers don't authenticate, so probing a possibly-offline box would
   * surface confusing setup errors).
   */
  readonly validate?: boolean;
  /**
   * Optional override for resolving the API key from the narrowed config.
   * Defaults to `config.apiKey`. The `local` provider uses this to fall back to
   * an env var + placeholder, since the OpenAI SDK requires a non-empty key but
   * local servers don't authenticate.
   */
  readonly resolveApiKey?: (config: OpenAICompatConfig) => string | undefined;
  /**
   * Optional override for resolving the base URL from the narrowed config.
   * Defaults to `config.baseURL ?? baseURL`. The `local` provider uses this to
   * insert an env-var fallback (`LOCAL_MODEL_BASE_URL`) between the config and
   * the static default, read per-call.
   */
  readonly resolveBaseURL?: (config: OpenAICompatConfig) => string;
}

/**
 * Build a {@link ProviderDef} for any vendor that speaks the OpenAI Chat
 * Completions wire protocol. Centralizes the construction shared by xai / zai /
 * google / local and the runtime-registered (`provider-admin`) vendors: it
 * reuses the shared {@link OpenAIProvider} with the vendor slug + base URL +
 * default model + catalog forced on, and (unless `validate: false`) wires
 * `validateOpenAICompatKey` against the vendor's base URL.
 *
 * The per-vendor file becomes a single declarative call carrying only the
 * vendor's constants; the cfg-narrowing + slug-forcing + validate wiring live
 * here once.
 */
export function defineOpenAICompatProvider(spec: DefineOpenAICompatProviderSpec): ProviderDef {
  const resolveApiKey = spec.resolveApiKey ?? ((cfg: OpenAICompatConfig) => cfg.apiKey);
  const resolveBaseURL = spec.resolveBaseURL ?? ((cfg: OpenAICompatConfig) => cfg.baseURL ?? spec.baseURL);
  // A key-bearing compat vendor ALWAYS pins `baseURL` to its own third-party
  // host. If the resolved apiKey is empty, the OpenAI SDK ctor silently falls
  // back to `process.env.OPENAI_API_KEY` (and OPENAI_BASE_URL is irrelevant
  // because we override baseURL) — which would ship the user's real OpenAI
  // credential to api.x.ai / Google / a runtime-registered vendor on a merely
  // MISCONFIGURED provider (no key set). Refuse an empty resolved key centrally
  // so every authenticating vendor (xai/google/provider-admin entries) is safe
  // without each re-adding its own guard. `validate: false` vendors (local
  // servers that don't authenticate and legitimately use a placeholder key via
  // resolveApiKey) are exempt.
  const requiresKey = spec.validate !== false;
  return defineProvider({
    name: spec.name,
    models: [...spec.models],
    createClient: (config) => {
      const cfg = pickOpenAICompatConfig(config);
      const apiKey = resolveApiKey(cfg);
      if (requiresKey && (typeof apiKey !== 'string' || apiKey.trim().length === 0)) {
        throw new Error(
          `${spec.name} requires an API key — configure the ${spec.name} provider's apiKey ` +
            `(refusing to fall back to OPENAI_API_KEY against ${spec.name}'s endpoint)`,
        );
      }
      return new OpenAIProvider({
        apiKey,
        name: spec.name,
        baseURL: resolveBaseURL(cfg),
        defaultModel: cfg.defaultModel ?? spec.defaultModel,
        models: spec.models,
      } satisfies OpenAIProviderConfig);
    },
    ...(spec.validate === false
      ? {}
      : { validateKey: (key: string) => validateOpenAICompatKey(key, { baseURL: spec.baseURL }) }),
    ...(spec.auth ? { auth: spec.auth } : {}),
  });
}
