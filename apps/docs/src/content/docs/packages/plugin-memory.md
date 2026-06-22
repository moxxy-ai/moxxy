---
title: '@moxxy/plugin-memory'
description: Long-term journal memory with TF-IDF or vector recall + short-term selectors.
---

`@moxxy/plugin-memory` is moxxy's persistent memory layer. Each memory
is one Markdown file with YAML frontmatter under `~/.moxxy/memory/`,
indexed by `MEMORY.md`. Short-term selectors fold the session's event
log into context-friendly summaries.

## Install

```sh
pnpm add @moxxy/plugin-memory
```

## Build

```ts
import { buildMemoryPlugin } from '@moxxy/plugin-memory';

const { plugin, store } = buildMemoryPlugin({
  // dir: '~/.moxxy/memory'   (default)
  // embedder: openaiEmbedder  (optional: enables vector recall mode)
});
session.pluginHost.registerStatic(plugin);
```

## Tools

| Tool | Permission | Purpose |
|---|---|---|
| `memory_save` | prompt | Persist a memory (name + type + description + body). |
| `memory_recall` | auto | Search by free-text query. Modes: `auto` (TF-IDF, vector if available), `vector`, `keyword`. |
| `memory_list` | auto | Names + descriptions, no body. |
| `memory_forget` | prompt | Delete by name. |
| `memory_update` | prompt | Update in place (preserves `createdAt`). |

## Memory types

`note`, `preference`, `fact`, `decision`, `lesson` — drives folder
placement and filtering.

## Short-term helpers

- `recentExchanges(log, n)` — last N user/assistant pairs.
- `summarizeSession(log)` — coarse fold over the whole log.

Used by the compactor and the discovery skill.

## Vector recall

Pair with an embedder plugin:

- `@moxxy/plugin-embeddings-openai` — `text-embedding-3-small/large`.
- `@moxxy/plugin-embeddings-transformers` — local CPU via `@huggingface/transformers`.

Both wrap automatically in `@moxxy/sdk`'s `CachedEmbeddingProvider`
(disk cache at `~/.moxxy/memory/.embeddings/`).

## Consolidation

`planConsolidation(entries)` proposes merges for overlapping memories.
`buildMemoryConsolidatePlugin(...)` ships a periodic consolidation
turn. See `packages/plugin-memory/src/consolidate.ts`.

## See also

- [Memory guide](../guides/memory.md) — manual curation, recall modes.
