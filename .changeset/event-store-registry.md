---
'@moxxy/sdk': minor
'@moxxy/core': minor
'@moxxy/config': minor
'@moxxy/cli': minor
---

EventStore registry — make the session event-log storage backend swappable (Pillar 2).

The JSONL persistence behind a session's event log is now a registry kind (`eventStore`) like any other swappable block, behind a new `EventStoreDef` contract (`open(scope)` for the write path; `restore`/`readPage` for resume + history paging). Core seeds the built-in JSONL store (`~/.moxxy/sessions/<id>.jsonl` + meta sidecar) as the **protected floor** — a thin adapter over the existing `SessionPersistence`, so behaviour is byte-identical.

A plugin can contribute an alternative store (SQLite, remote, encrypted, in-memory). Because the kind uses throw-on-duplicate `register` (not override) and the floor auto-adopts first, a discovered store is registered but never silently activates — the user opts in by name via `plugins.eventStore.default`. Since the store sees every event (prompts, tool I/O), that explicit opt-in is the trust boundary. The floor can be swapped but never removed, and a boot assertion guarantees a session always has an active store.

`SessionMeta`/`SessionSource`/`EventPage` moved to `@moxxy/sdk` (the contract's data shapes) and are re-exported from `@moxxy/core` — no importer churn.
