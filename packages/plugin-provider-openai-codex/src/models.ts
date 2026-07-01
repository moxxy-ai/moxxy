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
  // The ChatGPT-plan Codex backend enforces a ~400k window for the gpt-5-family
  // models it serves, well below the raw API ceiling. Advertising 1M here made
  // the proactive compactor's `estimatedTokens > 0.75 * contextWindow` gate
  // unreachable, so every overflow fell through to the reactive
  // compact-on-overflow retry. Keep these in step with the rest of the catalog.
  { id: 'gpt-5.5', contextWindow: 400_000, maxOutputTokens: 128_000, supportsTools: true, supportsStreaming: true, supportsImages: true, supportsDocuments: true, supportsReasoning: true },
  { id: 'gpt-5.4', contextWindow: 400_000, maxOutputTokens: 128_000, supportsTools: true, supportsStreaming: true, supportsImages: true, supportsDocuments: true, supportsReasoning: true },
  { id: 'gpt-5.4-mini', contextWindow: 400_000, maxOutputTokens: 128_000, supportsTools: true, supportsStreaming: true, supportsImages: true, supportsDocuments: true, supportsReasoning: true },
  { id: 'gpt-5.3-codex', contextWindow: 400_000, maxOutputTokens: 128_000, supportsTools: true, supportsStreaming: true, supportsImages: true, supportsDocuments: true, supportsReasoning: true },
  { id: 'gpt-5.3-codex-spark', contextWindow: 400_000, maxOutputTokens: 128_000, supportsTools: true, supportsStreaming: true, supportsImages: true, supportsDocuments: true, supportsReasoning: true },
  { id: 'gpt-5.2', contextWindow: 400_000, maxOutputTokens: 128_000, supportsTools: true, supportsStreaming: true, supportsImages: true, supportsDocuments: true, supportsReasoning: true },
];

export const DEFAULT_CODEX_MODEL = 'gpt-5.3-codex';
