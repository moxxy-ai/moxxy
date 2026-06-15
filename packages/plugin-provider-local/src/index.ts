import { defineProvider, definePlugin, type ModelDescriptor } from '@moxxy/sdk';
import { OpenAIProvider, type OpenAIProviderConfig } from '@moxxy/plugin-provider-openai';

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
 * vLLM). Reuses the shared {@link OpenAIProvider} pointed at a localhost base
 * URL, with the `local` slug forced on. No `validateKey` and no API key: local
 * servers don't authenticate, so the credential path supplies a placeholder
 * (see `resolveProviderCredentials` in the CLI) and activation never prompts.
 */
export const localProviderDef = defineProvider({
  name: 'local',
  models: [...localModels],
  createClient: (config) => {
    const cfg = config as OpenAIProviderConfig;
    return new OpenAIProvider({
      ...cfg,
      name: 'local',
      apiKey: cfg.apiKey ?? process.env.LOCAL_API_KEY ?? LOCAL_PLACEHOLDER_KEY,
      baseURL: cfg.baseURL ?? process.env.LOCAL_MODEL_BASE_URL ?? DEFAULT_LOCAL_BASE_URL,
      defaultModel: cfg.defaultModel ?? LOCAL_DEFAULT_MODEL,
      models: localModels,
    });
  },
  // No validateKey: there is no key to validate, and probing a local server
  // that may be offline would surface confusing errors during setup.
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
