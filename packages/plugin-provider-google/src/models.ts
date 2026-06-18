import type { ModelDescriptor } from '@moxxy/sdk';

/**
 * Google Gemini model catalog, as of 2026-06 (verify against
 * https://ai.google.dev/gemini-api/docs/models). Served here via Gemini's
 * OpenAI-compatibility endpoint, so these stream through the shared
 * {@link import('@moxxy/plugin-provider-openai').OpenAIProvider}. The Gemini 3
 * and 2.5 families all carry a 1M-token context window and are natively
 * multimodal (image input). An unlisted model id still works — it's passed
 * straight through to the endpoint; the catalog only drives context-window
 * budgets and capability gating.
 */
export const geminiModels: ReadonlyArray<ModelDescriptor> = [
  // Gemini 3 family: current frontier. Reasoning models that natively accept
  // PDF document input (supportsDocuments) so the desktop ships raw bytes
  // instead of degrading to extracted text.
  { id: 'gemini-3-pro', contextWindow: 1_000_000, maxOutputTokens: 65_536, supportsTools: true, supportsStreaming: true, supportsImages: true, supportsDocuments: true, supportsReasoning: true },
  { id: 'gemini-3-flash', contextWindow: 1_000_000, maxOutputTokens: 65_536, supportsTools: true, supportsStreaming: true, supportsImages: true, supportsDocuments: true, supportsReasoning: true },

  // Gemini 2.5 family: widely available, strong price/performance. pro/flash
  // are reasoning models; all three take native PDFs.
  { id: 'gemini-2.5-pro', contextWindow: 1_000_000, maxOutputTokens: 65_536, supportsTools: true, supportsStreaming: true, supportsImages: true, supportsDocuments: true, supportsReasoning: true },
  { id: 'gemini-2.5-flash', contextWindow: 1_000_000, maxOutputTokens: 65_536, supportsTools: true, supportsStreaming: true, supportsImages: true, supportsDocuments: true, supportsReasoning: true },
  { id: 'gemini-2.5-flash-lite', contextWindow: 1_000_000, maxOutputTokens: 65_536, supportsTools: true, supportsStreaming: true, supportsImages: true, supportsDocuments: true },
];
