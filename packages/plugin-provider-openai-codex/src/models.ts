import type { ModelDescriptor } from '@moxxy/sdk';

/**
 * Models the ChatGPT-plan backend will serve. Mirrors opencode's ALLOWED_MODELS
 * set (`packages/opencode/src/plugin/codex.ts`). The API-key OpenAI provider
 * still exposes the full catalog; this list is the subset the Codex backend
 * routes to ChatGPT-Pro/Plus subscribers without per-token billing.
 */
// Every Codex-served model is a gpt-5-family reasoning model, so all advertise
// `supportsReasoning` — the request already sends `reasoning.summary: 'auto'`;
// the per-provider toggle decides whether the summary is surfaced.
export const codexModels: ReadonlyArray<ModelDescriptor> = [
  { id: 'gpt-5.5', contextWindow: 1_000_000, maxOutputTokens: 128_000, supportsTools: true, supportsStreaming: true, supportsImages: true, supportsDocuments: true, supportsReasoning: true },
  { id: 'gpt-5.4', contextWindow: 1_000_000, maxOutputTokens: 128_000, supportsTools: true, supportsStreaming: true, supportsImages: true, supportsDocuments: true, supportsReasoning: true },
  { id: 'gpt-5.4-mini', contextWindow: 400_000, maxOutputTokens: 128_000, supportsTools: true, supportsStreaming: true, supportsImages: true, supportsDocuments: true, supportsReasoning: true },
  { id: 'gpt-5.3-codex', contextWindow: 400_000, maxOutputTokens: 128_000, supportsTools: true, supportsStreaming: true, supportsImages: true, supportsDocuments: true, supportsReasoning: true },
  { id: 'gpt-5.3-codex-spark', contextWindow: 400_000, maxOutputTokens: 128_000, supportsTools: true, supportsStreaming: true, supportsImages: true, supportsDocuments: true, supportsReasoning: true },
  { id: 'gpt-5.2', contextWindow: 400_000, maxOutputTokens: 128_000, supportsTools: true, supportsStreaming: true, supportsImages: true, supportsDocuments: true, supportsReasoning: true },
];

export const DEFAULT_CODEX_MODEL = 'gpt-5.3-codex';
