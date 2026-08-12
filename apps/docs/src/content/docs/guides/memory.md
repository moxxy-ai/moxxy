---
title: Memory
description: Long-term journal memory, short-term selectors, and manual curation.
---

`@moxxy/plugin-memory` is moxxy's cross-session, long-term memory layer.
It stores one Markdown file per durable fact, preference, decision, or
lesson under `~/.moxxy/memory/` plus a `MEMORY.md` index. Conversation
history stays in the session log; it is not copied into long-term memory.

## Three layers, three jobs

| Layer | Stores | Retrieval |
|---|---|---|
| Event log | Every exact event in the current logical session | `recall({ turnId, seq, callId })` |
| Session episodes | One dense record per completed turn, with older records folded into chapters | `session_recall({ query })`, then exact `recall` |
| Long-term memory | Curated knowledge useful in future sessions | `memory_recall({ query })` |

This keeps very long sessions reliable without treating every message
as permanent knowledge. The provider receives a bounded working set:
recent turns, compact episode records, and only the exact older material
it recalls. The immutable log remains the source of truth.

## How memories get saved

The plugin contributes five tools (`packages/plugin-memory/src/index.ts`):

| Tool | Purpose |
|---|---|
| `memory_save` | Persist a memory (name + type + description + body). Requires approval. |
| `memory_recall` | Search by free-text query (TF-IDF or vector). |
| `memory_list` | Names + descriptions (no body). |
| `memory_forget` | Delete by name. |
| `memory_update` | Update in place (preserves `createdAt`). |

The agent calls `memory_save` when you give it instructions to remember
something. Recall happens implicitly on relevant prompts via the
discovery skill.

## Recall modes

`memory_recall` takes a `mode`:

| Mode | Behavior |
|---|---|
| `auto` | TF-IDF baseline; upgrades to vector if an embedder is configured. |
| `vector` | Force vector similarity (requires an `EmbeddingProvider`). |
| `keyword` | Plain substring + token-overlap match. |

Embedders ship as separate plugins:

- `@moxxy/plugin-embeddings-openai` — `text-embedding-3-small/large`.
- `@moxxy/plugin-embeddings-transformers` — local CPU via `@huggingface/transformers`.

Both wrap automatically in `@moxxy/sdk`'s `CachedEmbeddingProvider`
(disk cache at `~/.moxxy/memory/.embeddings/`).

## Manual curation

```sh
moxxy memory list                     # name · type · description
moxxy memory audit                    # full audit: size, dates, tags by type
moxxy memory show <name>              # print the body
moxxy memory revert <name>            # delete one entry
moxxy memory prune-stale --days 90    # delete entries not touched in N days
moxxy memory path
```

## Consolidation

`planConsolidation()` (exported from `@moxxy/plugin-memory`) detects
overlapping memories and proposes a merge. The optional consolidate
plugin runs this periodically. See `packages/plugin-memory/src/consolidate.ts`.

## Short-term memory

The default `segments` compactor treats each substantial completed turn
as a sub-session: user request, actions, outcome, facts, and open work.
It keeps the recent tail verbatim, bounds the record index, and folds
old records into chapters before the context window fills.

Nothing is deleted. `session_recall` searches those records offline;
`recall({ turnId })` retrieves the exact original turn when detail is
needed. `recentExchanges(log, n)` and `summarizeSession(log)` remain
available as lower-level folds for plugins.

Do not auto-save every exchange with `memory_save`. Raw conversational
turns contain temporary instructions, superseded decisions, tool noise,
and sometimes secrets. Promote only durable knowledge to long-term
memory, with provenance and an explicit update path when it changes.

## Types

`MemoryType` is one of `note`, `preference`, `fact`, `decision`, `lesson`.
The type drives which folder the file lands in and is used as a filter
in `memory_list` / `memory_recall`.

## Storage layout

```
~/.moxxy/memory/
  MEMORY.md               human-readable index (one line per memory)
  note/<slug>.md
  preference/<slug>.md
  fact/<slug>.md
  decision/<slug>.md
  lesson/<slug>.md
  .embeddings/            cached vectors (created on first vector recall)
```

Each entry is plain Markdown with YAML frontmatter — git-friendly,
hand-editable, and survives schema changes via `parseMdFile`.
