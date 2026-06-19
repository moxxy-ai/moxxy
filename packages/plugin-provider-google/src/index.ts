import { definePlugin } from '@moxxy/sdk';
import { defineOpenAICompatProvider } from '@moxxy/plugin-provider-openai';
import { geminiModels } from './models.js';

export { geminiModels };

/** Gemini's OpenAI-compatibility endpoint (trailing slash matters for the SDK). */
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/';
const GEMINI_DEFAULT_MODEL = 'gemini-2.5-flash';

/**
 * Google Gemini, served via Gemini's OpenAI-compatibility endpoint so it
 * reuses the shared {@link defineOpenAICompatProvider} with the `google` slug +
 * base URL + Gemini catalog forced on (so usage stats, provider events and
 * error context attribute to `google`, not `openai`). The canonical key is
 * `GOOGLE_API_KEY`.
 */
export const googleProviderDef = defineOpenAICompatProvider({
  name: 'google',
  baseURL: GEMINI_BASE_URL,
  defaultModel: GEMINI_DEFAULT_MODEL,
  models: geminiModels,
  auth: {
    kind: 'apiKey',
    // Pin the env var explicitly: Google's own docs hand users GEMINI_API_KEY,
    // but moxxy resolves credentials under the canonical GOOGLE_API_KEY. Naming
    // it here (instead of relying on name-inference) keeps the setup hint and
    // the resolver in agreement.
    envVar: 'GOOGLE_API_KEY',
    hint: 'Google AI Studio (Gemini) API key from https://aistudio.google.com/apikey (set GOOGLE_API_KEY)',
  },
});

// `version` is intentionally omitted — definePlugin defaults it; a hardcoded
// literal here would permanently diverge from package.json and masquerade as a
// real version in diagnostics.
export const googlePlugin = definePlugin({
  name: '@moxxy/plugin-provider-google',
  providers: [googleProviderDef],
});

export default googlePlugin;
