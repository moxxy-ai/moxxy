---
"@moxxy/core": minor
"@moxxy/workspace-registry": minor
"@moxxy/desktop-host": minor
"@moxxy/plugin-channel-mobile": patch
"@moxxy/cli": patch
---

Unify sessions into a single source of truth across TUI / desktop / mobile.

A session now lives in exactly ONE place — its per-session file
`~/.moxxy/sessions/<id>.json` (the conversation stays in the append-only
`<id>.jsonl`). `~/.moxxy/desktop/desks.json` is reduced to a thin workspace
overlay (desk definitions + active pointers); the per-desk session list is
DERIVED from the session files at read time and grouped by an explicit `groupId`
(falling back to cwd for CLI/TUI sessions). Deleting a session = erasing its file,
so a removed session/workspace can never resurrect — which removes the whole class
of "deleted workspace comes back after restart" bugs and deletes ~300 lines of
copy/reconciliation code (`syncSessionIndexIntoRegistry`, `registerSessionFromMeta`,
partial-resume detection, legacy name hydration, the `withSessionTitles` pass).

- `@moxxy/core`: the session metadata file (`<id>.json`, versioned) gains
  `source` (originating channel), `groupId` (workspace membership) and `title`
  (user rename). New helpers: `listSessionMetas` (cheap, mtime-cached, single
  `readdir`), `seedSessionMeta`, `setSessionTitle`, `setSessionGroup`. The runner
  adopts a file's stable identity (`startedAt`/`source`) and PRESERVES the
  UI-owned `title`/`groupId` across its writes, so a live runner never clobbers a
  rename/move. `deleteSession` is the single deletion mechanism.
- `@moxxy/workspace-registry`: derives the desk/session view from the session
  files with an mtime-parse cache; `moveSession` re-homes a session by `groupId`.
- `@moxxy/desktop-host`: a sessions-dir watcher pushes a debounced (and
  projection-diffed) `desks.changed` so a title/first-prompt/new-session/deletion
  syncs live to desktop + mobile; the desk-removal flow tears runners down before
  erasing files.
- No migration: pre-existing sessions may be dropped; old desk *definitions* are
  read in place (their embedded session arrays are ignored).
