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
    hint: 'Google AI Studio (Gemini) API key from https://aistudio.google.com/apikey',
  },
});

export const googlePlugin = definePlugin({
  name: '@moxxy/plugin-provider-google',
  version: '0.0.0',
  providers: [googleProviderDef],
});

export default googlePlugin;
