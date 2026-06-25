---
"@moxxy/cli": patch
---

fix(tui): hide special modes from Shift+Tab + load history on session switch

- **Secret modes leaked into Shift+Tab.** The Shift+Tab mode cycle used the raw
  mode registry, so special modes (e.g. `collaborative`, entered via `/collab`)
  showed up in the cycle. It now filters with `isSelectableMode`, matching the
  `/mode` picker. The Telegram `/mode` picker and its by-name callback are
  hardened the same way (special modes are never offered or name-switched).
- **Session switch didn't load history.** Switching sessions in the TUI (and
  `--resume`) changed the active session but rendered an empty chat body —
  `bootSession` seeds the new `EventLog` directly, which doesn't fire
  subscribers, so `useEventStream` (which only listened for future appends)
  showed nothing while the status-line token count was correct. It now seeds the
  renderer from the history the log already holds.
