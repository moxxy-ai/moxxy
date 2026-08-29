import {
  classifyHttpStatus,
  classifyNetworkError,
  definePlugin,
  defineProvider,
  MoxxyError,
  type LLMProvider,
  type ModelDescriptor,
} from '@moxxy/sdk';
import {
  OpenAIProvider,
  openAICompatModelsURL,
  pickOpenAICompatConfig,
  type OpenAICompatConfig,
} from '@moxxy/plugin-provider-openai';
import { z } from 'zod';

/**
 * Default endpoint: Ollama's OpenAI-compatible server. Override with the
 * `LOCAL_MODEL_BASE_URL` env var (or `provider.config.baseURL`) to point at LM
 * Studio (`http://localhost:1234/v1`), llama.cpp, vLLM, or a remote box.
 */
export const DEFAULT_LOCAL_BASE_URL = 'http://localhost:11434/v1';
const LOCAL_DEFAULT_MODEL = 'llama3.3';
/**
 * Local servers don't authenticate, but the OpenAI SDK requires a non-empty
 * key. Use a harmless placeholder unless one is explicitly provided.
 */
const LOCAL_PLACEHOLDER_KEY = 'local';

/**
 * Conservative context-window floor for the seed catalog. Stock Ollama defaults
 * to `num_ctx` 2k–4k and other servers vary widely; the value here only seeds
 * the compaction/elision budget. Over-claiming (e.g. 131k) means the budget
 * guard never fires and the backend silently truncates the prompt once the real
 * window is exceeded — under-claiming degrades gracefully, so floor it. Raise it
 * via `provider.config.defaultModel`/a pinned descriptor when `num_ctx` is known.
 */
const LOCAL_CONTEXT_FLOOR = 8_192;

/**
 * A small catalog of popular local models as sensible defaults. Local model ids
 * vary by whatever the user has pulled, so this is intentionally short — an
 * unlisted id (e.g. `mistral-small`, `phi4`, a custom tag) still works, since
 * the id is passed straight through to the local server. The catalog only seeds
 * the `/model` picker and gives context-window budgets a starting point.
 *
 * `supportsTools` is optimistic only for ids that reliably do OpenAI
 * tool-calling (llama3.3 / qwen). Reasoning/experimental builds (deepseek-r1,
 * gpt-oss) and many quantized pulls don't, so they default conservative rather
 * than advertising a capability the backend ignores or 400s on. Confirm per
 * pulled model.
 */
export const localModels: ReadonlyArray<ModelDescriptor> = [
  { id: 'llama3.3', contextWindow: LOCAL_CONTEXT_FLOOR, supportsTools: true, supportsStreaming: true },
  { id: 'qwen3', contextWindow: LOCAL_CONTEXT_FLOOR, supportsTools: true, supportsStreaming: true },
  { id: 'qwen2.5-coder', contextWindow: LOCAL_CONTEXT_FLOOR, supportsTools: true, supportsStreaming: true },
  { id: 'deepseek-r1', contextWindow: LOCAL_CONTEXT_FLOOR, supportsTools: false, supportsStreaming: true },
  { id: 'gpt-oss', contextWindow: LOCAL_CONTEXT_FLOOR, supportsTools: false, supportsStreaming: true },
];

/** Hosts that keep traffic on the local machine — no data egress. */
function isLoopbackHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h === '::1' || h === '0.0.0.0' || h === '::') return true;
  if (h.endsWith('.localhost')) return true;
  // IPv4 loopback block 127.0.0.0/8.
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h);
}

// Warn at most once per distinct non-loopback host. Bounded so a pathological
// caller that cycles base URLs can't grow this without limit; once the bound is
// reached, further never-before-seen hosts are silently suppressed (rather than
// re-warning on every call) — 64 distinct remote endpoints is already
// pathological, and unbounded log spam is its own failure mode.
const warnedRemoteHosts = new Set<string>();
const MAX_WARNED_HOSTS = 64;

/**
 * Test-only: clear the once-per-host warning memo so a suite can assert
 * deterministic warn counts independent of which other tests ran first. Not part
 * of the runtime API — the memo is process-lifetime and never reset in prod.
 * @internal
 */
export function __resetRemoteWarningsForTests(): void {
  warnedRemoteHosts.clear();
}

/**
 * Resolve and validate the base URL the prompt (which can carry session context,
 * file contents, and shown secrets) will be POSTed to. Precedence matches the
 * prior behaviour: `provider.config.baseURL` → `LOCAL_MODEL_BASE_URL` env →
 * Ollama default. Because this provider is branded `local` and runs with
 * `validate: false` (no setup probe), a mistaken/poisoned URL would otherwise
 * silently redirect ALL traffic (and the placeholder credential) to an
 * arbitrary endpoint over an arbitrary scheme. So: reject anything that isn't
 * parseable http/https, and surface a one-time warning when the resolved host
 * leaves the local machine so egress is visible (remote boxes are explicitly
 * supported, hence a warning rather than a hard block).
 */
function resolveLocalBaseURL(cfg: OpenAICompatConfig): string {
  const raw = cfg.baseURL ?? process.env.LOCAL_MODEL_BASE_URL ?? DEFAULT_LOCAL_BASE_URL;
  let url: URL;
  try {
    url = new URL(raw);
  } catch (cause) {
    throw new MoxxyError({
      code: 'CONFIG_INVALID',
      message: `local provider baseURL is not a valid URL: ${raw}`,
      hint: 'Set provider.config.baseURL or LOCAL_MODEL_BASE_URL to e.g. http://localhost:11434/v1',
      context: { provider: 'local' },
      cause,
    });
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new MoxxyError({
      code: 'CONFIG_INVALID',
      message: `local provider baseURL must use http or https, got ${url.protocol}//`,
      hint: 'Set provider.config.baseURL or LOCAL_MODEL_BASE_URL to an http(s) endpoint.',
      context: { provider: 'local', url: raw },
    });
  }
  if (
    !isLoopbackHost(url.hostname) &&
    !warnedRemoteHosts.has(url.hostname) &&
    warnedRemoteHosts.size < MAX_WARNED_HOSTS
  ) {
    // Only warn for hosts we can record, so the once-per-host guarantee holds
    // even past the cap (an unrecorded host would otherwise re-warn every call).
    warnedRemoteHosts.add(url.hostname);
    console.warn(
      `[local] sending prompts to a non-local endpoint (${url.host}). ` +
        'Conversation context, file contents and shown secrets are POSTed there.',
    );
  }
  return raw;
}

const localModelsResponseSchema = z.object({
  data: z.array(z.object({ id: z.unknown() }).passthrough()).nullable(),
}).passthrough();

const MODEL_DISCOVERY_TIMEOUT_MS = 15_000;
const OLLAMA_METADATA_TIMEOUT_MS = 2_000;
const OLLAMA_UNLOADED_CONTEXT_FLOOR = 4_096;
const MAX_CONTEXT_WINDOW = 10_000_000;

export interface LocalModelDiscoveryOptions {
  readonly signal?: AbortSignal;
}

const ollamaRunningResponseSchema = z.object({
  models: z.array(z.object({
    name: z.string().optional(),
    model: z.string().optional(),
    context_length: z.number().int().positive().max(MAX_CONTEXT_WINDOW).optional(),
  }).passthrough()),
}).passthrough();

const ollamaShowResponseSchema = z.object({
  model_info: z.record(z.string(), z.unknown()).optional(),
  parameters: z.string().optional(),
  modelfile: z.string().optional(),
  capabilities: z.array(z.string()).optional(),
}).passthrough();

type OllamaRunningResponse = z.infer<typeof ollamaRunningResponseSchema>;
type OllamaShowResponse = z.infer<typeof ollamaShowResponseSchema>;

/**
 * Read the model catalog exposed by Ollama or another OpenAI-compatible local
 * server. IDs are returned byte-for-byte as advertised because tags, owner
 * prefixes and `:cloud` suffixes are part of the model's public identifier.
 */
export async function discoverLocalModels(
  config: OpenAICompatConfig = {},
  options: LocalModelDiscoveryOptions = {},
): Promise<ReadonlyArray<string>> {
  const baseURL = resolveLocalBaseURL(config);
  const modelsURL = openAICompatModelsURL(baseURL);
  const signal = options.signal ?? AbortSignal.timeout(MODEL_DISCOVERY_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(modelsURL, {
      headers: { accept: 'application/json' },
      signal,
    });
  } catch (cause) {
    if (cause instanceof Error && cause.name === 'TimeoutError') {
      throw new MoxxyError({
        code: 'NETWORK_TIMEOUT',
        message: `Local model discovery timed out at ${new URL(modelsURL).host}.`,
        hint: 'Make sure Ollama is running, then try refreshing the model list.',
        context: { provider: 'local', url: modelsURL },
        cause,
      });
    }
    const classified = classifyNetworkError(cause, { provider: 'local', url: modelsURL });
    if (classified) throw classified;
    throw MoxxyError.wrap(cause, {
      code: 'NETWORK_UNREACHABLE',
      message: `Could not reach the local model server at ${new URL(modelsURL).host}.`,
      hint: 'Make sure Ollama is running, then try refreshing the model list.',
      context: { provider: 'local', url: modelsURL },
    });
  }

  if (!response.ok) {
    const body = await response.text();
    const classified = classifyHttpStatus(response.status, {
      provider: 'local',
      url: modelsURL,
      body,
    });
    if (classified) throw classified;
    throw new MoxxyError({
      code: 'PROVIDER_UNKNOWN_RESPONSE',
      message: `Local model server returned HTTP ${response.status}.`,
      context: { provider: 'local', url: modelsURL, status: response.status },
    });
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (cause) {
    throw new MoxxyError({
      code: 'PROVIDER_UNKNOWN_RESPONSE',
      message: 'Local model server returned invalid JSON from /v1/models.',
      hint: 'Check that LOCAL_MODEL_BASE_URL points to an OpenAI-compatible endpoint.',
      context: { provider: 'local', url: modelsURL },
      cause,
    });
  }

  const parsed = localModelsResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new MoxxyError({
      code: 'PROVIDER_UNKNOWN_RESPONSE',
      message: 'Local model server returned an invalid /v1/models response.',
      hint: 'Check that LOCAL_MODEL_BASE_URL points to an OpenAI-compatible endpoint.',
      context: { provider: 'local', url: modelsURL },
      cause: parsed.error,
    });
  }

  const ids = (parsed.data.data ?? [])
    .map((model) => model.id)
    .filter((id): id is string => typeof id === 'string' && id.trim().length > 0);
  return [...new Set(ids)].sort();
}

/**
 * Enrich the live local catalog with Ollama-native runtime metadata. Servers
 * that only implement the OpenAI-compatible surface retain the existing
 * conservative descriptors; no Ollama endpoint is assumed from a model id.
 */
export async function discoverLocalModelDescriptors(
  config: OpenAICompatConfig = {},
  options: LocalModelDiscoveryOptions = {},
): Promise<ReadonlyArray<ModelDescriptor>> {
  const ids = await discoverLocalModels(config, options);
  if (ids.length === 0) return [];
  const baseURL = resolveLocalBaseURL(config);
  const running = await readOllamaRunning(baseURL, options.signal);
  if (!running) return ids.map(genericLocalDescriptor);

  return Promise.all(ids.map(async (id) => {
    const show = await readOllamaShow(baseURL, id, options.signal);
    return ollamaDescriptor(id, running, show);
  }));
}

async function discoverOllamaModelDescriptor(
  model: string,
  config: OpenAICompatConfig,
  options: LocalModelDiscoveryOptions,
): Promise<ModelDescriptor | null> {
  const baseURL = resolveLocalBaseURL(config);
  const running = await readOllamaRunning(baseURL, options.signal);
  if (!running) return null;
  const show = await readOllamaShow(baseURL, model, options.signal);
  return ollamaDescriptor(model, running, show);
}

function genericLocalDescriptor(id: string): ModelDescriptor {
  const seeded = localModels.find((model) => model.id === id);
  return seeded ?? {
    id,
    contextWindow: LOCAL_CONTEXT_FLOOR,
    supportsTools: true,
    supportsStreaming: true,
  };
}

function ollamaDescriptor(
  id: string,
  running: OllamaRunningResponse,
  show: OllamaShowResponse | null,
): ModelDescriptor {
  const active = running.models.find((entry) => entry.name === id || entry.model === id);
  const maximum = show ? modelMaximumContext(show.model_info) : null;
  const configured = show ? configuredNumCtx(show) : null;
  const contextWindow = active?.context_length
    ?? clampConfiguredContext(configured, maximum)
    ?? Math.min(maximum ?? OLLAMA_UNLOADED_CONTEXT_FLOOR, OLLAMA_UNLOADED_CONTEXT_FLOOR);
  const capabilities = show?.capabilities;
  const seeded = localModels.find((model) => model.id === id);
  const supportsTools = capabilities
    ? capabilities.includes('tools')
    : (seeded?.supportsTools ?? true);
  const supportsImages = capabilities?.includes('vision') === true;
  return {
    id,
    contextWindow,
    supportsTools,
    supportsStreaming: true,
    ...(supportsImages ? { supportsImages: true } : {}),
  };
}

function modelMaximumContext(modelInfo: Record<string, unknown> | undefined): number | null {
  if (!modelInfo) return null;
  const values = Object.entries(modelInfo)
    .filter(([key]) => key.endsWith('.context_length'))
    .map(([, value]) => value)
    .filter((value): value is number => (
      typeof value === 'number'
      && Number.isInteger(value)
      && value > 0
      && value <= MAX_CONTEXT_WINDOW
    ));
  return values.length > 0 ? Math.max(...values) : null;
}

function configuredNumCtx(show: OllamaShowResponse): number | null {
  const sources = [show.parameters, show.modelfile].filter(
    (value): value is string => typeof value === 'string',
  );
  for (const source of sources) {
    const match = /(?:^|\n)\s*(?:PARAMETER\s+)?num_ctx\s+(\d+)\b/im.exec(source);
    if (!match) continue;
    const value = Number(match[1]);
    if (Number.isInteger(value) && value > 0 && value <= MAX_CONTEXT_WINDOW) return value;
  }
  return null;
}

function clampConfiguredContext(configured: number | null, maximum: number | null): number | null {
  if (!configured) return null;
  return maximum ? Math.min(configured, maximum) : configured;
}

function ollamaNativeURL(baseURL: string, endpoint: 'ps' | 'show'): string {
  const url = new URL(baseURL);
  url.search = '';
  url.hash = '';
  let path = url.pathname.replace(/\/+$/, '');
  if (path.endsWith('/v1/models')) path = path.slice(0, -'/v1/models'.length);
  else if (path.endsWith('/v1')) path = path.slice(0, -'/v1'.length);
  url.pathname = `${path}/api/${endpoint}`;
  return url.toString();
}

function metadataSignal(signal?: AbortSignal): AbortSignal {
  return signal
    ? AbortSignal.any([signal, AbortSignal.timeout(OLLAMA_METADATA_TIMEOUT_MS)])
    : AbortSignal.timeout(OLLAMA_METADATA_TIMEOUT_MS);
}

async function readOllamaRunning(
  baseURL: string,
  signal?: AbortSignal,
): Promise<OllamaRunningResponse | null> {
  try {
    const response = await fetch(ollamaNativeURL(baseURL, 'ps'), {
      headers: { accept: 'application/json' },
      signal: metadataSignal(signal),
    });
    if (!response.ok) return null;
    const parsed = ollamaRunningResponseSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

async function readOllamaShow(
  baseURL: string,
  model: string,
  signal?: AbortSignal,
): Promise<OllamaShowResponse | null> {
  try {
    const response = await fetch(ollamaNativeURL(baseURL, 'show'), {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ model }),
      signal: metadataSignal(signal),
    });
    if (!response.ok) return null;
    const parsed = ollamaShowResponseSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

class OllamaAwareLocalProvider implements LLMProvider {
  readonly name = 'local';
  readonly models: ReadonlyArray<ModelDescriptor>;

  constructor(
    private readonly delegate: OpenAIProvider,
    private readonly catalog: ModelDescriptor[],
    private readonly config: OpenAICompatConfig,
  ) {
    this.models = catalog;
  }

  async prepareModel(
    model: string,
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<void> {
    if (options.signal?.aborted) return;
    const descriptor = await discoverOllamaModelDescriptor(model, this.config, options);
    if (!descriptor || options.signal?.aborted) return;
    const index = this.catalog.findIndex((candidate) => candidate.id === model);
    if (index >= 0) this.catalog.splice(index, 1, descriptor);
    else this.catalog.push(descriptor);
  }

  stream(req: Parameters<OpenAIProvider['stream']>[0]) {
    return this.delegate.stream(req);
  }

  countTokens(req: Parameters<OpenAIProvider['countTokens']>[0]): Promise<number> {
    return this.delegate.countTokens(req);
  }
}

/**
 * Local models via any OpenAI-compatible server (Ollama, LM Studio, llama.cpp,
 * vLLM). Reuses the shared {@link defineOpenAICompatProvider} pointed at a
 * localhost base URL, with the `local` slug forced on. `validate: false` and a
 * placeholder API key: local servers don't authenticate, so the credential path
 * supplies a placeholder (see `resolveProviderCredentials` in the CLI),
 * activation never prompts, and we never probe a possibly-offline box.
 *
 * Env-var resolution is duplicated by design: in the CLI flow
 * `resolveProviderCredentials` pre-resolves `apiKey`/`baseURL` into the config
 * (so the env reads below are unreachable there), but non-CLI callers
 * (desktop / provider-admin direct `createClient`) don't — these `resolve*`
 * functions are the authoritative readers for them, with identical precedence.
 */
export const localProviderDef = defineProvider({
  name: 'local',
  models: [...localModels],
  supportsLiveModelDiscovery: true,
  createClient: (config) => {
    const cfg = pickOpenAICompatConfig(config);
    const baseURL = resolveLocalBaseURL(cfg);
    const catalog = [...localModels];
    const delegate = new OpenAIProvider({
      apiKey: cfg.apiKey ?? process.env.LOCAL_API_KEY ?? LOCAL_PLACEHOLDER_KEY,
      name: 'local',
      baseURL,
      defaultModel: cfg.defaultModel ?? LOCAL_DEFAULT_MODEL,
      models: catalog,
    });
    return new OllamaAwareLocalProvider(delegate, catalog, { ...cfg, baseURL });
  },
  auth: { kind: 'none' },
});

export const localPlugin = definePlugin({
  name: '@moxxy/plugin-provider-local',
  version: '0.0.0',
  providers: [localProviderDef],
});

export default localPlugin;
