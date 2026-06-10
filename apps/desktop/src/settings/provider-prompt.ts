/**
 * Prompt template for the "Add provider" agent flow — wraps the user's
 * free-text description in an instruction that drives the runner's provider
 * admin tools (provider_add / provider_test) with the vault rules baked in.
 */
export const PROVIDER_PROMPT_TEMPLATE = (description: string): string => `You are
registering a new LLM provider for the user, using the provider admin tools.

1. Call provider_add with kind "openai-compat", a short slug name, the
   vendor's baseURL, a defaultModel, and a models list (id + contextWindow
   at minimum). For vendors you recognise (deepseek, groq, openrouter,
   together, fireworks, mistral, z.ai, …) use their well-known baseURL and
   current flagship models instead of asking.
2. NEVER ask for or echo a plaintext API key. The user stores it themselves
   as the vault entry <NAME>_API_KEY (Settings → Vault, or /vault set). If
   they say the key is already stored, verify it with provider_test
   (baseURL + keyName).

Finish with a single short line confirming the provider was registered and
which vault key activates it, or a single clear question if you are blocked.
No code fences, no long explanations.

USER DESCRIPTION:
${description}`.trim();
