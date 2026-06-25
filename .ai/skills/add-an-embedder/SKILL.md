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

Consumer to know about: `plugin-memory` (TF-IDF/vector recall) still uses its
own `EmbeddingIndex` cache — TECH_DEBT.md P3 #6; if you touch its recall path
anyway, fold in `CachedEmbeddingProvider`.

Test: deterministic vectors via a fake fetch / tiny fixture; assert cache
hits skip the upstream call (`sdk/src/embedding-cache.ts` tests show the
contract).
