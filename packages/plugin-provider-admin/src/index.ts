import {
  defineTool,
  definePlugin,
  MoxxyError,
  z,
  type Plugin,
  type ProviderAdminView,
  type ProviderConfigurePatch,
  type ProviderDef,
} from '@moxxy/sdk';
import { buildProviderDef, validateOpenAICompatKey } from './factory.js';
import { providerApiKeyName } from './key-name.js';
import {
  providersConfigPath,
  readProvidersConfig,
  removeStoredProvider,
  upsertStoredProvider,
} from './store.js';
import type { StoredProvider } from './types.js';

/** Logger surface this plugin opportunistically uses if the host wires one. */
interface WarnLogger {
  warn(msg: string, meta?: unknown): void;
}

/**
 * `AppContext` doesn't declare a `logger` (warnings are best-effort), but some
 * hosts attach one. Narrow with a runtime guard rather than asserting its shape
 * via a blanket cast, so a non-conforming `logger` is simply ignored.
 */
function getWarnLogger(ctx: unknown): WarnLogger | undefined {
  if (typeof ctx !== 'object' || ctx === null) return undefined;
  const candidate = (ctx as { logger?: unknown }).logger;
  if (typeof candidate === 'object' && candidate !== null && typeof (candidate as WarnLogger).warn === 'function') {
    return candidate as WarnLogger;
  }
  return undefined;
}

export { providersConfigPath, readProvidersConfig, upsertStoredProvider, removeStoredProvider };
export type { StoredProvider, StoredProviderOpenAICompat, StoredProvidersConfig } from './types.js';
export { buildProviderDef, validateOpenAICompatKey } from './factory.js';
export { providerApiKeyName, storedProviderApiKeyName } from './key-name.js';

/**
 * Minimal subset of the in-process ProviderRegistry the admin plugin
 * needs. Keeping the surface narrow lets us pass either the live
 * `session.providers` from the CLI or a fake from tests.
 */
export interface ProviderRegistryLike {
  register(def: ProviderDef): void;
  replace(def: ProviderDef): void;
  unregister(name: string): void;
  list(): ReadonlyArray<ProviderDef>;
}

export interface BuildProviderAdminPluginOptions {
  /** Live provider registry — the plugin (un)registers stored defs against it. */
  readonly providerRegistry: ProviderRegistryLike;
  /** Override the on-disk path. Tests inject a tmp file here. */
  readonly configPath?: string;
}

const PROVIDER_NAME_RE = /^[a-z][a-z0-9-]*$/;

const providerNameSchema = z
  .string()
  .min(1)
  .max(60)
  .regex(PROVIDER_NAME_RE, 'name must be slug-like (lowercase letters, digits, hyphens; must start with a letter)');

const modelDescriptorSchema = z.object({
  id: z.string().min(1),
  contextWindow: z.number().int().positive(),
  maxOutputTokens: z.number().int().positive().optional(),
  supportsTools: z.boolean().default(true),
  supportsStreaming: z.boolean().default(true),
  supportsImages: z.boolean().optional(),
  /**
   * Whether the model ingests `document` blocks (native PDF etc.). Without
   * this flag the desktop degrades attachments to extracted text for every
   * runtime-registered provider — declare it for models that take files.
   */
  supportsDocuments: z.boolean().optional(),
  supportsAudio: z.boolean().optional(),
});

const addProviderInput = z.object({
  kind: z
    .enum(['openai-compat'])
    .default('openai-compat')
    .describe(
      'Wire-protocol family the vendor speaks. "openai-compat" reuses the moxxy ' +
        'OpenAI client against a vendor baseURL (z.ai, deepseek, groq, openrouter, …). ' +
        'Native-SDK vendors must ship as a dedicated plugin instead.',
    ),
  name: providerNameSchema.describe('Provider slug. Becomes the registry key + canonical vault entry (<NAME>_API_KEY).'),
  baseURL: z
    .string()
    .url()
    .describe('Vendor API base URL, e.g. https://api.z.ai/api/coding/paas/v4.'),
  defaultModel: z.string().min(1).describe('Model id used when a request does not pin one explicitly.'),
  models: z
    .array(modelDescriptorSchema)
    .min(1)
    .describe('Models the vendor exposes. Powers /model autocomplete and the setup wizard.'),
  envVar: z
    .string()
    .regex(/^[A-Z][A-Z0-9_]*$/)
    .optional()
    .describe('Override the API-key env-var name (defaults to <NAME>_API_KEY).'),
});

const removeProviderInput = z.object({
  name: providerNameSchema,
});

const testProviderInput = z.object({
  baseURL: z.string().url().describe('Vendor API base URL to probe, e.g. https://api.deepseek.com.'),
  keyName: z
    .string()
    .regex(/^[A-Z][A-Z0-9_]*$/)
    .describe(
      'NAME of the vault secret holding the API key (e.g. DEEPSEEK_API_KEY). The key is ' +
        'resolved from the vault inside the tool — never ask the user for the plaintext key ' +
        'and never pass one as a tool argument. Have them store it first: /vault set <NAME> <key>.',
    ),
});

/**
 * Like {@link buildProviderAdminPlugin} but also returns a
 * {@link ProviderAdminView} api the host can stash on the session
 * (`session.providerAdmin`) so channels — and the runner's
 * `provider.configure` method — can edit a stored provider without going
 * through the model. Mirrors `buildMcpAdminPluginWithApi`.
 */
export function buildProviderAdminPluginWithApi(opts: BuildProviderAdminPluginOptions): {
  readonly plugin: Plugin;
  readonly api: ProviderAdminView;
} {
  const { providerRegistry, configPath } = opts;
  const builtinNames = reservedBuiltinNames(providerRegistry);
  const api: ProviderAdminView = {
    configure: async (name: string, patch: ProviderConfigurePatch): Promise<void> => {
      if (builtinNames.has(name)) {
        throw new MoxxyError({
          code: 'CONFIG_INVALID',
          message:
            `provider-admin: "${name}" is a built-in provider and cannot be reconfigured here — ` +
            `built-ins are code. Only runtime-registered (providers.json) providers are editable.`,
        });
      }
      const cfg = await readProvidersConfig(configPath);
      const entry = cfg.providers.find((p) => p.name === name);
      if (!entry) {
        throw new MoxxyError({
          code: 'CONFIG_INVALID',
          message:
            `provider-admin: no stored provider named "${name}" — only runtime-registered ` +
            `(providers.json) providers are configurable; built-ins are code.`,
        });
      }
      const next: StoredProvider = {
        ...entry,
        ...(patch.baseURL ? { baseURL: patch.baseURL } : {}),
        ...(patch.defaultModel ? { defaultModel: patch.defaultModel } : {}),
        ...(patch.envVar ? { envVar: patch.envVar } : {}),
        ...(patch.models && patch.models.length > 0 ? { models: patch.models } : {}),
      };
      if (!next.models.some((m) => m.id === next.defaultModel)) {
        throw new MoxxyError({
          code: 'CONFIG_INVALID',
          message:
            `provider-admin: defaultModel "${next.defaultModel}" is not in the models list ` +
            `(${next.models.map((m) => m.id).join(', ')}).`,
        });
      }
      // Same order as provider_add: live registry first, then disk, so a
      // failed write can roll back to the previous def.
      const def = buildProviderDef(next);
      const hadDef = providerRegistry.list().some((p) => p.name === name);
      if (hadDef) providerRegistry.replace(def);
      else providerRegistry.register(def);
      try {
        await upsertStoredProvider(next, configPath);
      } catch (err) {
        const prev = buildProviderDef(entry);
        if (hadDef) providerRegistry.replace(prev);
        else providerRegistry.unregister(name);
        throw err;
      }
    },
  };
  return { plugin: buildProviderAdminPlugin(opts), api };
}

/**
 * Snapshot the names already present in the registry the moment the plugin is
 * built. Those are the host's built-in/code providers (anthropic, openai,
 * openai-codex, …). This plugin must never `replace()` one of them: the
 * register-vs-replace decision used to key off "is the name already in the
 * registry?", which let a `provider_add(name:'openai', baseURL:…)` — or a
 * colliding entry smuggled into providers.json and re-applied by onInit —
 * silently hot-swap the real built-in OpenAI provider's def with an
 * openai-compat shim pointed at an arbitrary endpoint, hijacking routing and
 * credentials. We reserve these names instead.
 */
function reservedBuiltinNames(providerRegistry: ProviderRegistryLike): ReadonlySet<string> {
  return new Set(providerRegistry.list().map((p) => p.name));
}

export function buildProviderAdminPlugin(opts: BuildProviderAdminPluginOptions): Plugin {
  const { providerRegistry, configPath } = opts;
  const builtinNames = reservedBuiltinNames(providerRegistry);

  return definePlugin({
    name: '@moxxy/plugin-provider-admin',
    version: '0.0.0',
    tools: [
      defineTool({
        name: 'provider_add',
        description:
          'Register an OpenAI-compatible LLM provider (z.ai, deepseek, groq, openrouter, fireworks, ' +
          'together, mistral, …) with moxxy. Wraps the in-process OpenAI client with the vendor baseURL + ' +
          'a user-supplied models list. Persists to ~/.moxxy/providers.json so the provider survives ' +
          'restarts. The new provider is registered in the LIVE session — switch to it with /provider ' +
          'or set it as the default in moxxy.config.ts.',
        inputSchema: addProviderInput,
        permission: { action: 'prompt' },
        handler: async (input) => {
          if (builtinNames.has(input.name)) {
            throw new MoxxyError({
              code: 'CONFIG_INVALID',
              message:
                `provider_add: "${input.name}" is a built-in provider and cannot be shadowed ` +
                `or redirected. Pick a different slug for your OpenAI-compatible vendor ` +
                `(e.g. "${input.name}-compat").`,
            });
          }
          const entry: StoredProvider = {
            kind: 'openai-compat',
            name: input.name,
            baseURL: input.baseURL,
            defaultModel: input.defaultModel,
            models: input.models,
            ...(input.envVar ? { envVar: input.envVar } : {}),
            createdAt: new Date().toISOString(),
          };
          if (!entry.models.some((m) => m.id === entry.defaultModel)) {
            throw new MoxxyError({
              code: 'CONFIG_INVALID',
              message:
                `provider_add: defaultModel "${entry.defaultModel}" is not in the models list. ` +
                `Add it to the array or pick one of: ${entry.models.map((m) => m.id).join(', ')}.`,
            });
          }
          const def = buildProviderDef(entry);
          const wasRegistered = providerRegistry.list().some((p) => p.name === entry.name);
          if (wasRegistered) providerRegistry.replace(def);
          else providerRegistry.register(def);
          try {
            await upsertStoredProvider(entry, configPath);
          } catch (err) {
            // Roll back the runtime registration so the next boot
            // doesn't see a phantom that isn't on disk.
            providerRegistry.unregister(entry.name);
            throw err;
          }
          const vaultKeyName = providerApiKeyName(entry);
          return {
            ok: true,
            name: entry.name,
            kind: entry.kind,
            baseURL: entry.baseURL,
            defaultModel: entry.defaultModel,
            models: entry.models.map((m) => m.id),
            path: configPath ?? providersConfigPath(),
            replaced: wasRegistered,
            note:
              `Provider "${entry.name}" is live in this session. ` +
              `Have the USER store the API key by running: /vault set ${vaultKeyName} <key> ` +
              `— never ask them to paste the key to you. ` +
              `Once stored, you can verify it with provider_test (baseURL + keyName "${vaultKeyName}") — it resolves the key from the vault itself. ` +
              `Switch with the /provider command or set provider.name in moxxy.config.ts.`,
          };
        },
      }),
      defineTool({
        name: 'provider_list',
        description:
          'List user-registered providers (persisted in ~/.moxxy/providers.json) plus their default model and base URL. ' +
          'Built-in providers (anthropic, openai, openai-codex) are NOT included — query session.providers for those.',
        inputSchema: z.object({}),
        handler: async () => {
          const cfg = await readProvidersConfig(configPath);
          return {
            path: configPath ?? providersConfigPath(),
            providers: cfg.providers.map((p) => ({
              name: p.name,
              kind: p.kind,
              baseURL: p.baseURL,
              defaultModel: p.defaultModel,
              models: p.models.map((m) => m.id),
              envVar: providerApiKeyName(p),
            })),
          };
        },
      }),
      defineTool({
        name: 'provider_remove',
        description:
          'Remove a previously-added provider from ~/.moxxy/providers.json and detach it from the live session. ' +
          'Does NOT delete the stored API key — call vault_delete name=<NAME>_API_KEY separately if you also want to drop the credential.',
        inputSchema: removeProviderInput,
        permission: { action: 'prompt' },
        handler: async ({ name }) => {
          const removed = await removeStoredProvider(name, configPath);
          if (!removed) {
            return { ok: false, name, note: `No stored provider named "${name}".` };
          }
          try {
            providerRegistry.unregister(name);
          } catch {
            // Already gone in the live registry — best effort.
          }
          return { ok: true, name, note: `Removed "${name}" from providers.json and detached from session.` };
        },
      }),
      defineTool({
        name: 'provider_test',
        description:
          'Probe an OpenAI-compatible endpoint by calling /v1/models. Takes the NAME of a vault ' +
          'secret (e.g. ZAI_API_KEY) and resolves the API key via the vault inside the handler — ' +
          'the plaintext key never enters the conversation or logs. Have the USER store the key ' +
          'first with /vault set <NAME> <key>, then call this to confirm the baseURL + key are ' +
          'valid (typically before provider_add). Returns { ok: true } on success or ' +
          '{ ok: false, message } with the vendor error verbatim.',
        inputSchema: testProviderInput,
        permission: { action: 'prompt' },
        // The plaintext key is resolved HERE, at call time, via ctx.getSecret —
        // it never appears as tool input/output, so it stays out of the model
        // context, the runner session log, and the desktop NDJSON log.
        handler: async ({ baseURL, keyName }, ctx) => {
          if (!ctx.getSecret) {
            return {
              ok: false,
              message:
                'provider_test: this session has no secret vault wired in (ctx.getSecret is ' +
                'unavailable), so the key cannot be resolved. Register the provider with ' +
                'provider_add and have the user verify the key with `moxxy doctor` instead.',
            };
          }
          const apiKey = await ctx.getSecret(keyName);
          if (!apiKey) {
            return {
              ok: false,
              message:
                `provider_test: no vault secret named "${keyName}". Ask the USER to store it ` +
                `by running: /vault set ${keyName} <key> — then call provider_test again with ` +
                `keyName "${keyName}". Never ask them to paste the key into the conversation.`,
            };
          }
          return validateOpenAICompatKey(apiKey, { baseURL });
        },
      }),
    ],
    hooks: {
      onInit: async (ctx) => {
        const log = getWarnLogger(ctx);
        let cfg;
        try {
          cfg = await readProvidersConfig(configPath);
        } catch (err) {
          log?.warn('provider-admin: failed to read providers.json', {
            err: err instanceof Error ? err.message : String(err),
          });
          return;
        }
        for (const entry of cfg.providers) {
          try {
            if (builtinNames.has(entry.name)) {
              // A colliding entry in providers.json must never overwrite a
              // built-in def. Skip it (a poisoned/legacy store can't hijack
              // the real provider's routing on boot).
              log?.warn(
                `provider-admin: skipping stored provider "${entry.name}" — it collides with a built-in`,
              );
              continue;
            }
            const def = buildProviderDef(entry);
            const already = providerRegistry.list().some((p) => p.name === entry.name);
            if (already) providerRegistry.replace(def);
            else providerRegistry.register(def);
          } catch (err) {
            log?.warn(`provider-admin: failed to register "${entry.name}"`, {
              err: err instanceof Error ? err.message : String(err),
            });
          }
        }
      },
    },
  });
}
