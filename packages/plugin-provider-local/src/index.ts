import { definePlugin, type ModelDescriptor } from '@moxxy/sdk';
import { defineOpenAICompatProvider } from '@moxxy/plugin-provider-openai';

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
 * A small catalog of popular local models as sensible defaults. Local model ids
 * vary by whatever the user has pulled, so this is intentionally short — an
 * unlisted id (e.g. `mistral-small`, `phi4`, a custom tag) still works, since
 * the id is passed straight through to the local server. The catalog only seeds
 * the `/model` picker and gives context-window budgets a starting point;
 * context windows here are conservative defaults that depend on how the server
 * was launched (Ollama's `num_ctx`, etc.).
 */
export const localModels: ReadonlyArray<ModelDescriptor> = [
  { id: 'llama3.3', contextWindow: 131_072, supportsTools: true, supportsStreaming: true },
  { id: 'qwen3', contextWindow: 131_072, supportsTools: true, supportsStreaming: true },
  { id: 'qwen2.5-coder', contextWindow: 131_072, supportsTools: true, supportsStreaming: true },
  { id: 'deepseek-r1', contextWindow: 131_072, supportsTools: true, supportsStreaming: true },
  { id: 'gpt-oss', contextWindow: 131_072, supportsTools: true, supportsStreaming: true },
];

/**
 * Local models via any OpenAI-compatible server (Ollama, LM Studio, llama.cpp,
 * vLLM). Reuses the shared {@link defineOpenAICompatProvider} pointed at a
 * localhost base URL, with the `local` slug forced on. `validate: false` and a
 * placeholder API key: local servers don't authenticate, so the credential path
 * supplies a placeholder (see `resolveProviderCredentials` in the CLI),
 * activation never prompts, and we never probe a possibly-offline box.
 *
 * The `LOCAL_API_KEY` / `LOCAL_MODEL_BASE_URL` env fallbacks are resolved
 * per-call (between the config and the static defaults) to match the prior
 * behaviour exactly.
 */
export const localProviderDef = defineOpenAICompatProvider({
  name: 'local',
  baseURL: DEFAULT_LOCAL_BASE_URL,
  defaultModel: LOCAL_DEFAULT_MODEL,
  models: localModels,
  validate: false,
  resolveApiKey: (cfg) => cfg.apiKey ?? process.env.LOCAL_API_KEY ?? LOCAL_PLACEHOLDER_KEY,
  resolveBaseURL: (cfg) => cfg.baseURL ?? process.env.LOCAL_MODEL_BASE_URL ?? DEFAULT_LOCAL_BASE_URL,
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
