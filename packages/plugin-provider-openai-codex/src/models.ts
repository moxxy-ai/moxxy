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
// The Codex backend serves every model below with a 272k window and uses 95%
// of it (`effective_context_window_percent`), even where the raw API window is
// 1.05M. Advertising more made the proactive compactor's
// `estimatedTokens > 0.75 * contextWindow` gate unreachable, so every overflow
// fell through to the reactive compact-on-overflow retry.
const CODEX_CONTEXT_WINDOW = 258_400;
// The OAuth backend rejects `max_output_tokens`; this is only the compactor's
// reserve for the reply.
const CODEX_OUTPUT_RESERVE = 16_384;

export const codexModels: ReadonlyArray<ModelDescriptor> = [
  // GPT-6: Astra, Sol (flagship) and Luna (fast).
  { id: 'gpt-6-astra', contextWindow: CODEX_CONTEXT_WINDOW, maxOutputTokens: CODEX_OUTPUT_RESERVE, supportsTools: true, supportsStreaming: true, supportsImages: true, supportsDocuments: true, supportsReasoning: true, supportsFast: true, hostedTools: ['web_search'] },
  { id: 'gpt-6-sol', contextWindow: CODEX_CONTEXT_WINDOW, maxOutputTokens: CODEX_OUTPUT_RESERVE, supportsTools: true, supportsStreaming: true, supportsImages: true, supportsDocuments: true, supportsReasoning: true, supportsFast: true, hostedTools: ['web_search'] },
  { id: 'gpt-6-luna', contextWindow: CODEX_CONTEXT_WINDOW, maxOutputTokens: CODEX_OUTPUT_RESERVE, supportsTools: true, supportsStreaming: true, supportsImages: true, supportsDocuments: true, supportsReasoning: true, supportsFast: true, hostedTools: ['web_search'] },
  // GPT-5.6 family (GA July 9, 2026), under the same ids the API uses.
  { id: 'gpt-5.6-sol', contextWindow: CODEX_CONTEXT_WINDOW, maxOutputTokens: CODEX_OUTPUT_RESERVE, supportsTools: true, supportsStreaming: true, supportsImages: true, supportsDocuments: true, supportsReasoning: true, supportsFast: true, hostedTools: ['web_search'] },
  { id: 'gpt-5.6-terra', contextWindow: CODEX_CONTEXT_WINDOW, maxOutputTokens: CODEX_OUTPUT_RESERVE, supportsTools: true, supportsStreaming: true, supportsImages: true, supportsDocuments: true, supportsReasoning: true, supportsFast: true, hostedTools: ['web_search'] },
  { id: 'gpt-5.6-luna', contextWindow: CODEX_CONTEXT_WINDOW, maxOutputTokens: CODEX_OUTPUT_RESERVE, supportsTools: true, supportsStreaming: true, supportsImages: true, supportsDocuments: true, supportsReasoning: true, supportsFast: true, hostedTools: ['web_search'] },
];

// OpenAI's own Codex default moved to gpt-5.6-sol at GA (July 9, 2026); mirror
// it so a ChatGPT-plan user who hasn't pinned a model gets the current flagship.
export const DEFAULT_CODEX_MODEL = 'gpt-5.6-sol';
