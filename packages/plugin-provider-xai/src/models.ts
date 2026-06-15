import type { ModelDescriptor } from '@moxxy/sdk';

/**
 * xAI Grok model catalog, as of 2026-06 (verify against
 * https://docs.x.ai/docs/models). The xAI API is OpenAI-compatible, so these
 * stream through the shared {@link import('@moxxy/plugin-provider-openai').OpenAIProvider}.
 * grok-4.3 is the current flagship with a 1M context; the grok-4 tier is 256k;
 * grok-3 is 131k. Vision is available on the grok-4 family. An unlisted model
 * id still works — it's passed straight through to api.x.ai; the catalog only
 * drives context-window budgets and capability gating.
 */
export const grokModels: ReadonlyArray<ModelDescriptor> = [
  // grok-4 family: current frontier. 4.3 is the flagship (1M context).
  { id: 'grok-4.3', contextWindow: 1_000_000, supportsTools: true, supportsStreaming: true, supportsImages: true },
  { id: 'grok-4', contextWindow: 256_000, supportsTools: true, supportsStreaming: true, supportsImages: true },
  { id: 'grok-4-fast', contextWindow: 256_000, supportsTools: true, supportsStreaming: true, supportsImages: true },

  // grok-code-fast-1: agentic-coding specialist (text-only).
  { id: 'grok-code-fast-1', contextWindow: 256_000, supportsTools: true, supportsStreaming: true },

  // grok-3 tier: prior generation, still served.
  { id: 'grok-3', contextWindow: 131_072, supportsTools: true, supportsStreaming: true },
  { id: 'grok-3-mini', contextWindow: 131_072, supportsTools: true, supportsStreaming: true },
];
