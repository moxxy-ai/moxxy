import type { ModelDescriptor } from '@moxxy/sdk';

/**
 * Google Gemini model catalog, as of 2026-06 (verify against
 * https://ai.google.dev/gemini-api/docs/models). Served here via Gemini's
 * OpenAI-compatibility endpoint, so these stream through the shared
 * {@link import('@moxxy/plugin-provider-openai').OpenAIProvider}. The Gemini 3
 * and 2.5 families all carry a 1M-token context window and are natively
 * multimodal (image input).
 *
 * An unlisted model id still works for raw inference — it's passed straight
 * through to the endpoint — but it loses Gemini-correct budgeting: the
 * descriptor lookup misses, so context-window/capability gating falls back to
 * the host's miss-path default instead of the 1M window asserted here.
 *
 * supportsDocuments is intentionally NOT set: although Gemini natively accepts
 * PDFs on its own API (via `inline_data`), the OpenAI-compatibility surface
 * does not honor the OpenAI `file`/`file_data` content part the shared
 * translate layer emits for `document` blocks. Asserting it would make the
 * desktop ship raw PDF bytes the endpoint rejects/ignores — losing the
 * document entirely with no fallback. Leaving it unset keeps the safe
 * extracted-text path. Images ride `image_url` data URLs, which the compat
 * endpoint does accept, so supportsImages stays true.
 */
export const geminiModels: ReadonlyArray<ModelDescriptor> = [
  // Gemini 3 family: current frontier. Reasoning models.
  { id: 'gemini-3-pro', contextWindow: 1_000_000, maxOutputTokens: 65_536, supportsTools: true, supportsStreaming: true, supportsImages: true, supportsReasoning: true },
  { id: 'gemini-3-flash', contextWindow: 1_000_000, maxOutputTokens: 65_536, supportsTools: true, supportsStreaming: true, supportsImages: true, supportsReasoning: true },

  // Gemini 2.5 family: widely available, strong price/performance. pro/flash
  // are reasoning models.
  { id: 'gemini-2.5-pro', contextWindow: 1_000_000, maxOutputTokens: 65_536, supportsTools: true, supportsStreaming: true, supportsImages: true, supportsReasoning: true },
  { id: 'gemini-2.5-flash', contextWindow: 1_000_000, maxOutputTokens: 65_536, supportsTools: true, supportsStreaming: true, supportsImages: true, supportsReasoning: true },
  { id: 'gemini-2.5-flash-lite', contextWindow: 1_000_000, maxOutputTokens: 65_536, supportsTools: true, supportsStreaming: true, supportsImages: true },
];
