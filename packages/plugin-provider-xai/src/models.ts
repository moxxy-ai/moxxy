import type { ModelDescriptor } from '@moxxy/sdk';

/**
 * xAI Grok model catalog, as of 2026-06 (verify against
 * https://docs.x.ai/docs/models). The xAI API is OpenAI-compatible, so these
 * stream through the shared {@link import('@moxxy/plugin-provider-openai').OpenAIProvider}.
 * grok-4.3 is the current flagship with a 1M context; the grok-4 tier is 256k;
 * grok-3 is 131k. Vision is available on the grok-4 family. An unlisted model
 * id still works — it's passed straight through to api.x.ai; the catalog only
 * drives context-window budgets and capability gating.
 *
 * The grok-4 family + grok-3-mini are reasoning models — xAI streams their
 * `reasoning_content` deltas, which the shared OpenAIProvider already surfaces;
 * supportsReasoning gates reasoning_effort + reasoning-stream surfacing on
 * (without it the capability is dead upstream even when the user enables it).
 *
 * supportsDocuments is intentionally NOT set: the xAI API is reached through the
 * OpenAI-compatibility surface, and (like the Gemini compat endpoint) it does
 * not honor the OpenAI `file`/`file_data` content part the shared translate
 * layer emits for `document` blocks. Asserting it would make the desktop ship
 * raw PDF bytes the endpoint rejects/ignores — losing the document with no
 * fallback. Leaving it unset keeps the safe extracted-text path. Images ride
 * `image_url` data URLs (accepted), so supportsImages stays true on the vision
 * tier.
 */
export const grokModels: ReadonlyArray<ModelDescriptor> = [
  // grok-4 family: current frontier. 4.3 is the flagship (1M context). Reasoning + vision.
  { id: 'grok-4.3', contextWindow: 1_000_000, maxOutputTokens: 64_000, supportsTools: true, supportsStreaming: true, supportsImages: true, supportsReasoning: true },
  { id: 'grok-4', contextWindow: 256_000, maxOutputTokens: 64_000, supportsTools: true, supportsStreaming: true, supportsImages: true, supportsReasoning: true },
  { id: 'grok-4-fast', contextWindow: 256_000, maxOutputTokens: 64_000, supportsTools: true, supportsStreaming: true, supportsImages: true, supportsReasoning: true },

  // grok-code-fast-1: agentic-coding specialist (text-only). Reasoning model.
  { id: 'grok-code-fast-1', contextWindow: 256_000, maxOutputTokens: 64_000, supportsTools: true, supportsStreaming: true, supportsReasoning: true },

  // grok-3 tier: prior generation, still served. Only the -mini variant reasons.
  { id: 'grok-3', contextWindow: 131_072, maxOutputTokens: 32_768, supportsTools: true, supportsStreaming: true },
  { id: 'grok-3-mini', contextWindow: 131_072, maxOutputTokens: 32_768, supportsTools: true, supportsStreaming: true, supportsReasoning: true },
];
