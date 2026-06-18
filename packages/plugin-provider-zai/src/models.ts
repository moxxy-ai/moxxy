import type { ModelDescriptor } from '@moxxy/sdk';

/**
 * z.ai (Zhipu) GLM model catalog, as of 2026-06. Shared by both the
 * pay-as-you-go `zai` provider (OpenAI-compatible endpoint) and the
 * `zai-coding-plan` provider (Anthropic-compatible endpoint) — the GLM model
 * ids are identical across both surfaces; only the transport/billing differ.
 *
 * Numbers are the documented limits as of June 2026 (verify against
 * https://docs.z.ai/guides/llm). GLM-5.2 is the coding-first flagship with a
 * usable 1M-token context (released 2026-06-13); the GLM-4.5 tier tops out at
 * 128k. Only the `-v` (vision) variants accept image input. An unlisted model
 * id still streams fine — it's passed straight through to the endpoint; the
 * catalog only drives context-window budgets and capability gating.
 */
export const glmModels: ReadonlyArray<ModelDescriptor> = [
  // GLM-5 family: coding-first frontier. 5.2 carries a usable 1M context.
  // These are reasoning models; the shared OpenAIProvider already streams their
  // `reasoning_content` deltas, so supportsReasoning gates reasoning_effort +
  // reasoning-stream surfacing on (without it the capability is dead upstream).
  { id: 'glm-5.2', contextWindow: 1_000_000, maxOutputTokens: 128_000, supportsTools: true, supportsStreaming: true, supportsReasoning: true },
  { id: 'glm-5.1', contextWindow: 200_000, maxOutputTokens: 128_000, supportsTools: true, supportsStreaming: true, supportsReasoning: true },
  { id: 'glm-5', contextWindow: 200_000, maxOutputTokens: 128_000, supportsTools: true, supportsStreaming: true, supportsReasoning: true },

  // GLM-4.6: prior flagship, 200k context, strong agentic-coding scores.
  { id: 'glm-4.6', contextWindow: 200_000, maxOutputTokens: 128_000, supportsTools: true, supportsStreaming: true, supportsReasoning: true },

  // GLM-4.5 tier: general (4.5), lightweight (-air), free/fast (-flash).
  { id: 'glm-4.5', contextWindow: 131_072, maxOutputTokens: 98_304, supportsTools: true, supportsStreaming: true },
  { id: 'glm-4.5-air', contextWindow: 131_072, maxOutputTokens: 98_304, supportsTools: true, supportsStreaming: true },
  { id: 'glm-4.5-flash', contextWindow: 131_072, maxOutputTokens: 98_304, supportsTools: true, supportsStreaming: true },

  // Vision-capable variant.
  { id: 'glm-4.5v', contextWindow: 65_536, maxOutputTokens: 16_384, supportsTools: true, supportsStreaming: true, supportsImages: true },
];
