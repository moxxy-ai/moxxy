import { definePlugin, MoxxyError, type ModelDescriptor } from '@moxxy/sdk';
import {
  defineOpenAICompatProvider,
  type OpenAICompatConfig,
} from '@moxxy/plugin-provider-openai';

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
// caller that cycles base URLs can't grow this without limit.
const warnedRemoteHosts = new Set<string>();
const MAX_WARNED_HOSTS = 64;

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
  if (!isLoopbackHost(url.hostname) && !warnedRemoteHosts.has(url.hostname)) {
    if (warnedRemoteHosts.size < MAX_WARNED_HOSTS) warnedRemoteHosts.add(url.hostname);
    console.warn(
      `[local] sending prompts to a non-local endpoint (${url.host}). ` +
        'Conversation context, file contents and shown secrets are POSTed there.',
    );
  }
  return raw;
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
export const localProviderDef = defineOpenAICompatProvider({
  name: 'local',
  baseURL: DEFAULT_LOCAL_BASE_URL,
  defaultModel: LOCAL_DEFAULT_MODEL,
  models: localModels,
  validate: false,
  resolveApiKey: (cfg) => cfg.apiKey ?? process.env.LOCAL_API_KEY ?? LOCAL_PLACEHOLDER_KEY,
  resolveBaseURL: resolveLocalBaseURL,
  auth: {
    kind: 'apiKey',
    envVar: 'LOCAL_API_KEY',
    hint: 'optional — local servers need no key; set LOCAL_MODEL_BASE_URL for a non-Ollama endpoint',
  },
});

export const localPlugin = definePlugin({
  name: '@moxxy/plugin-provider-local',
  version: '0.0.0',
  providers: [localProviderDef],
});

export default localPlugin;
