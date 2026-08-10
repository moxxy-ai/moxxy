---
name: add-an-embedder
description: Add an embedding provider (Embedder) for memory/recall — use when wiring a new embeddings API or on-device model.
---

# Add an embedder

Existing impls: `plugin-embeddings-openai` (API) and
`plugin-embeddings-transformers` (on-device, xenova).

Checklist:
- `defineEmbedder({ name, ... })` from `@moxxy/sdk`; contribute via
  `definePlugin({ embedders: [...] })` → `EmbedderRegistry`; register in
  `packages/cli/src/setup/builtins.ts`.
- **Wrap with `CachedEmbeddingProvider`** (SDK) instead of rolling a cache —
  and keep cache keys MODEL-SCOPED (`<vendor>:<model>`): unscoped keys
  collided across models once (audit phase 5).
- Heavy model deps (transformers) stay external to the CLI bundle — check
  `packages/cli/tsup.config.ts` `external` before adding a native/huge dep.
- Key resolution like providers: vault first, then env (add-a-provider skill).

Consumer to know about: `plugin-memory` (TF-IDF/vector recall) has its own
`EmbeddingIndex` cache. If you change that recall path, prefer converging on
`CachedEmbeddingProvider` instead of creating a third cache contract.

Test: deterministic vectors via a fake fetch / tiny fixture; assert cache
hits skip the upstream call (`sdk/src/embedding-cache.ts` tests show the
contract).
