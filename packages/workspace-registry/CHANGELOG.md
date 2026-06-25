# @moxxy/workspace-registry

## 0.2.6

### Patch Changes

- Updated dependencies [074f845]
- Updated dependencies [3a4b604]
  - @moxxy/sdk@0.21.0
  - @moxxy/core@0.21.0
  - @moxxy/desktop-ipc-contract@0.12.2

## 0.2.5

### Patch Changes

- Updated dependencies [2ccd62e]
- Updated dependencies [9bff8a1]
- Updated dependencies [497e9a1]
- Updated dependencies [bddaa83]
- Updated dependencies [e3491a9]
- Updated dependencies [5c1c334]
- Updated dependencies [238e434]
- Updated dependencies [2ccd62e]
  - @moxxy/sdk@0.20.0
  - @moxxy/core@0.7.0
  - @moxxy/desktop-ipc-contract@0.12.1

## 0.2.4

### Patch Changes

- Updated dependencies [08f927a]
  - @moxxy/sdk@0.19.0
  - @moxxy/desktop-ipc-contract@0.12.0
  - @moxxy/core@0.6.3

## 0.2.3

### Patch Changes

- Updated dependencies [c4b7f1c]
  - @moxxy/desktop-ipc-contract@0.11.0

## 0.2.2

### Patch Changes

- Updated dependencies [e4fe785]
  - @moxxy/sdk@0.18.0
  - @moxxy/core@0.6.2
  - @moxxy/desktop-ipc-contract@0.10.6

## 0.2.1

### Patch Changes

- Updated dependencies [0d6df6e]
  - @moxxy/sdk@0.17.0
  - @moxxy/core@0.6.1
  - @moxxy/desktop-ipc-contract@0.10.5

## 0.2.0

### Minor Changes

- 3862cb2: Unify sessions into a single source of truth across TUI / desktop / mobile.

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
  - No migration: pre-existing sessions may be dropped; old desk _definitions_ are
    read in place (their embedded session arrays are ignored).

### Patch Changes

- Updated dependencies [3862cb2]
  - @moxxy/core@0.6.0

## 0.1.1

### Patch Changes

- Updated dependencies [648c966]
  - @moxxy/sdk@0.16.1
  - @moxxy/core@0.5.4
  - @moxxy/desktop-ipc-contract@0.10.4
