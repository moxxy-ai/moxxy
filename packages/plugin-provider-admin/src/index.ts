import {
  createMutex,
  defineTool,
  definePlugin,
  MoxxyError,
  z,
  type Mutex,
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
  /**
   * Name of the currently-active provider, when the registry tracks one. The
   * live `session.providers` implements this; the narrow fake used in tests may
   * not — hence optional. Used to detect when a `replace()`/`unregister()`
   * targets the active provider so we can rebuild (or refuse).
   */
  getActiveName?(): string | null;
  /**
   * Rebuild + activate a provider's instance. `replace()` drops the cached
   * instance, so replacing the ACTIVE provider's def MUST be followed by
   * `setActive(name, config)` or `getActive()` throws on the next turn (the
   * invariant documented on core's ProviderRegistry).
   */
  setActive?(name: string, config?: Record<string, unknown>): unknown;
}

export interface BuildProviderAdminPluginOptions {
  /** Live provider registry — the plugin (un)registers stored defs against it. */
  readonly providerRegistry: ProviderRegistryLike;
  /** Override the on-disk path. Tests inject a tmp file here. */
  readonly configPath?: string;
  /**
   * Optional credential resolver. When supplied AND a reconfigure/replace
   * targets the currently-active provider, the plugin rebuilds the active
   * instance with this config so `getActive()` keeps working without a manual
   * re-select. Without it the plugin leaves the active instance alone (the host
   * — e.g. the runner, which owns the credential resolver — is responsible for
   * the rebuild). Mirrors the runner's `setActive` config resolution.
   */
  readonly resolveActiveConfig?: (name: string) => Promise<Record<string, unknown>> | Record<string, unknown>;
}

const PROVIDER_NAME_RE = /^[a-z][a-z0-9-]*$/;

const providerNameSchema = z
  .string()
  .min(1)
  .max(60)
  .regex(PROVIDER_NAME_RE, 'name must be slug-like (lowercase letters, digits, hyphens; must start with a letter)');

const ENV_VAR_RE = /^[A-Z][A-Z0-9_]*$/;

/**
 * Defense-in-depth check on a vendor base URL before the OpenAI SDK probes it
 * with a Bearer key. The permission prompt is the primary gate, but a base URL
 * a user might not scrutinize should not be able to point a stored credential
 * at an arbitrary host. We require https (allowing http only for explicit
 * localhost) and reject link-local / cloud-metadata addresses (SSRF + key
 * egress). The threat model treats baseURL as operator-controlled; this is a
 * backstop, not the trust boundary.
 */
function isSafeBaseURL(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  const host = url.hostname.toLowerCase();
  const isLocalhost = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
  if (url.protocol === 'http:') return isLocalhost;
  if (url.protocol !== 'https:') return false;
  // `localhost` over https is the only allowed loopback name; everything below
  // operates on the WHATWG-canonicalized host (decimal/hex/octal IPv4 forms are
  // already folded to dotted-decimal, so a `169.254.x` / private prefix can't be
  // smuggled as `https://2852039166/v1`).
  // Block loopback, link-local / metadata, unspecified, AND RFC1918 private
  // ranges even over https — a stored Bearer credential must not be egressable
  // to an internal/metadata host via a base URL the user might not scrutinize.
  if (
    host === 'localhost' ||
    host.startsWith('127.') || // IPv4 loopback 127.0.0.0/8
    host.startsWith('169.254.') || // IPv4 link-local incl. cloud metadata 169.254.169.254
    host.startsWith('0.') || // "this" network 0.0.0.0/8
    host === '0.0.0.0' ||
    host.startsWith('10.') || // RFC1918 10.0.0.0/8
    host.startsWith('192.168.') || // RFC1918 192.168.0.0/16
    isPrivate172(host) || // RFC1918 172.16.0.0/12
    host === '::1' ||
    host === '[::1]' || // IPv6 loopback
    host.startsWith('[fe80:') || // IPv6 link-local
    host.startsWith('[fc') || // IPv6 unique-local fc00::/7
    host.startsWith('[fd')
  ) {
    return false;
  }
  return true;
}

/** True for a dotted-decimal IPv4 host in the RFC1918 172.16.0.0/12 range. */
function isPrivate172(host: string): boolean {
  const m = /^172\.(\d{1,3})\./.exec(host);
  if (!m) return false;
  const octet = Number(m[1]);
  return octet >= 16 && octet <= 31;
}

const safeBaseURLSchema = z
  .string()
  .url()
  .refine(isSafeBaseURL, {
    message:
      'baseURL must be an https URL (or http://localhost). file://, ftp://, link-local and ' +
      'cloud-metadata addresses are rejected to prevent credential egress / SSRF.',
  });

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
}).passthrough();

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
  baseURL: safeBaseURLSchema.describe('Vendor API base URL, e.g. https://api.z.ai/api/coding/paas/v4.'),
  defaultModel: z.string().min(1).describe('Model id used when a request does not pin one explicitly.'),
  models: z
    .array(modelDescriptorSchema)
    .min(1)
    .describe('Models the vendor exposes. Powers /model autocomplete and the setup wizard.'),
  envVar: z
    .string()
    .regex(ENV_VAR_RE)
    .optional()
    .describe('Override the API-key env-var name (defaults to <NAME>_API_KEY).'),
});

const removeProviderInput = z.object({
  name: providerNameSchema,
});

/**
 * Validation for the `configure()` patch. `configure` is part of the exported
 * ProviderAdminView contract — ANY in-process consumer (a future channel, a
 * test, a plugin) can call it, not just the runner handler. The invariant must
 * live where the data is persisted, so a malformed baseURL/envVar can't reach
 * buildProviderDef + the vault key-name derivation through an alternate caller.
 * Mirrors the runner's providerConfigureParamsSchema.patch.
 */
const configurePatchSchema = z.object({
  baseURL: safeBaseURLSchema.optional(),
  defaultModel: z.string().min(1).optional(),
  envVar: z.string().regex(ENV_VAR_RE).optional(),
  models: z.array(modelDescriptorSchema).min(1).optional(),
});

const testProviderInput = z.object({
  baseURL: safeBaseURLSchema.describe('Vendor API base URL to probe, e.g. https://api.deepseek.com.'),
  keyName: z
    .string()
    .regex(ENV_VAR_RE)
    .describe(
      'NAME of the vault secret holding the API key (e.g. DEEPSEEK_API_KEY). The key is ' +
        'resolved from the vault inside the tool — never ask the user for the plaintext key ' +
        'and never pass one as a tool argument. Have them store it first: /vault set <NAME> <key>.',
    ),
});

/**
 * Shared state + critical-section helpers for one wired plugin instance. Both
 * {@link buildProviderAdminPlugin} and {@link buildProviderAdminPluginWithApi}
 * drive the SAME engine so the built-in guard, active-provider rebuild and the
 * registry-mutation lock are consistent across the tools and the configure API.
 */
interface ProviderAdminEngine {
  readonly providerRegistry: ProviderRegistryLike;
  readonly configPath?: string;
  /** Names registered BY THIS PLUGIN (provider_add/configure/onInit). */
  readonly ownNames: Set<string>;
  /**
   * Is `name` a host built-in (code provider) we must never replace? Evaluated
   * LAZILY against the LIVE registry minus our own names — NOT snapshotted at
   * build time, because the CLI builds this plugin BEFORE the host registers
   * its built-in provider defs, so a build-time snapshot is empty and the guard
   * is dead (a `provider_add({name:'openai'})` would silently hot-swap the real
   * built-in's def). A name present in the live registry that we did not put
   * there is, by definition, a built-in.
   */
  isBuiltin(name: string): boolean;
  /** Serialize the capture→registry-mutate→persist→rollback section per name. */
  withLock<T>(name: string, fn: () => Promise<T>): Promise<T>;
  /**
   * After `replace()` on the active provider, the cached instance is dropped
   * (core ProviderRegistry invariant) so `getActive()` throws until rebuilt.
   * Rebuild it with resolved config when the host wired a resolver. No-op when
   * `name` isn't active or the registry doesn't track an active provider.
   */
  rebuildActiveIfNeeded(name: string): Promise<void>;
}

function createProviderAdminEngine(opts: BuildProviderAdminPluginOptions): ProviderAdminEngine {
  const { providerRegistry, configPath, resolveActiveConfig } = opts;
  const ownNames = new Set<string>();
  // Per-name mutexes, ref-counted so the map is bounded by the number of
  // CONCURRENTLY-active names, not the cumulative count of every slug ever seen.
  // Without the counter a model issuing many distinct provider_add/remove calls
  // would grow this map without bound for the life of the runner. We can't probe
  // a Mutex's queue (the interface only exposes `run`), so we track holders
  // ourselves and drop the entry when the last in-flight call for a name settles.
  const locks = new Map<string, { mutex: Mutex; holders: number }>();
  return {
    providerRegistry,
    configPath,
    ownNames,
    isBuiltin(name: string): boolean {
      return providerRegistry.list().some((p) => p.name === name) && !ownNames.has(name);
    },
    async withLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
      let slot = locks.get(name);
      if (!slot) {
        slot = { mutex: createMutex(), holders: 0 };
        locks.set(name, slot);
      }
      slot.holders += 1;
      try {
        return await slot.mutex.run(fn);
      } finally {
        slot.holders -= 1;
        // Last holder out removes the entry. A name acquired again later just
        // creates a fresh mutex — serialization is only ever needed between
        // OVERLAPPING calls, which by definition still share this live slot.
        if (slot.holders === 0 && locks.get(name) === slot) locks.delete(name);
      }
    },
    async rebuildActiveIfNeeded(name: string): Promise<void> {
      if (!resolveActiveConfig) return;
      const activeName = providerRegistry.getActiveName?.();
      if (activeName !== name) return;
      try {
        const cfg = await resolveActiveConfig(name);
        providerRegistry.setActive?.(name, cfg);
      } catch {
        // Best-effort: a failed rebuild leaves `getActive()` throwing exactly as
        // it did before this fix — never worse — and the user can re-select.
      }
    },
  };
}

/**
 * Re-register a stored provider against the live registry + persist it. The
 * whole capture→mutate→persist→rollback sequence runs under the per-name lock so
 * concurrent admin calls (parallel tool calls / a configure racing an add) can't
 * interleave with stale prevDef snapshots. On a write failure the prior def is
 * restored (or the phantom dropped) so the registry never drifts from disk.
 */
async function applyStoredProvider(engine: ProviderAdminEngine, entry: StoredProvider): Promise<{ replaced: boolean }> {
  const { providerRegistry, configPath } = engine;
  return engine.withLock(entry.name, async () => {
    const def = buildProviderDef(entry);
    const prevDef = providerRegistry.list().find((p) => p.name === entry.name);
    const wasRegistered = prevDef !== undefined;
    if (wasRegistered) providerRegistry.replace(def);
    else providerRegistry.register(def);
    engine.ownNames.add(entry.name);
    try {
      await upsertStoredProvider(entry, configPath);
    } catch (err) {
      // Roll back the runtime registration. If a def existed before this call,
      // restore it; otherwise drop the phantom + our ownership claim so the next
      // boot doesn't see something that isn't on disk.
      if (wasRegistered && prevDef) providerRegistry.replace(prevDef);
      else {
        providerRegistry.unregister(entry.name);
        engine.ownNames.delete(entry.name);
      }
      throw err;
    }
    // Replacing the active provider's def dropped its cached instance — rebuild.
    if (wasRegistered) await engine.rebuildActiveIfNeeded(entry.name);
    return { replaced: wasRegistered };
  });
}

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
  const engine = createProviderAdminEngine(opts);
  const api: ProviderAdminView = {
    configure: async (name: string, patch: ProviderConfigurePatch): Promise<void> => {
      if (engine.isBuiltin(name)) {
        throw new MoxxyError({
          code: 'CONFIG_INVALID',
          message:
            `provider-admin: "${name}" is a built-in provider and cannot be reconfigured here — ` +
            `built-ins are code. Only runtime-registered (providers.json) providers are editable.`,
        });
      }
      // Defense-in-depth: validate the patch HERE (where it is persisted), not
      // only at the runner boundary, so any in-process caller is covered.
      const validated = configurePatchSchema.parse(patch);
      const cfg = await readProvidersConfig(engine.configPath);
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
        ...(validated.baseURL ? { baseURL: validated.baseURL } : {}),
        ...(validated.defaultModel ? { defaultModel: validated.defaultModel } : {}),
        ...(validated.envVar ? { envVar: validated.envVar } : {}),
        ...(validated.models && validated.models.length > 0 ? { models: validated.models } : {}),
      };
      if (!next.models.some((m) => m.id === next.defaultModel)) {
        throw new MoxxyError({
          code: 'CONFIG_INVALID',
          message:
            `provider-admin: defaultModel "${next.defaultModel}" is not in the models list ` +
            `(${next.models.map((m) => m.id).join(', ')}).`,
        });
      }
      // Same order as provider_add: live registry first, then disk, so a failed
      // write rolls back; the whole section is locked per name.
      await applyStoredProvider(engine, next);
    },
  };
  return { plugin: buildProviderAdminPlugin(opts, engine), api };
}

export function buildProviderAdminPlugin(
  opts: BuildProviderAdminPluginOptions,
  sharedEngine?: ProviderAdminEngine,
): Plugin {
  const engine = sharedEngine ?? createProviderAdminEngine(opts);
  const { providerRegistry, configPath } = engine;

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
          if (engine.isBuiltin(input.name)) {
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
          const { replaced: wasRegistered } = await applyStoredProvider(engine, entry);
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
          // Removing the ACTIVE provider leaves the registry with active=null, so
          // the next turn fails with a "no active provider" error. Mirror the
          // setEnabled guard's intent: surface the consequence prominently
          // instead of returning a cheerful ok with no warning.
          const removingActive = providerRegistry.getActiveName?.() === name;
          return engine.withLock(name, async () => {
            const removed = await removeStoredProvider(name, configPath);
            if (!removed) {
              return { ok: false, name, note: `No stored provider named "${name}".` };
            }
            try {
              providerRegistry.unregister(name);
            } catch {
              // Already gone in the live registry — best effort.
            }
            engine.ownNames.delete(name);
            const note = removingActive
              ? `Removed "${name}" from providers.json and detached from session. ` +
                `WARNING: "${name}" was the ACTIVE provider — the session now has NO active provider ` +
                `and the next turn will fail until you switch with the /provider command.`
              : `Removed "${name}" from providers.json and detached from session.`;
            return { ok: true, name, removedActive: removingActive, note };
          });
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
            // Evaluate built-in collision against the live registry MINUS our
            // own names BEFORE claiming ownership. A name present in the registry
            // that we didn't put there is a built-in (code provider) and must
            // never be overwritten by a poisoned/legacy store entry.
            if (engine.isBuiltin(entry.name)) {
              log?.warn(
                `provider-admin: skipping stored provider "${entry.name}" — it collides with a built-in`,
              );
              continue;
            }
            const def = buildProviderDef(entry);
            const already = providerRegistry.list().some((p) => p.name === entry.name);
            if (already) providerRegistry.replace(def);
            else providerRegistry.register(def);
            engine.ownNames.add(entry.name);
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
