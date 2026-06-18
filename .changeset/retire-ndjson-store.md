---
"@moxxy/desktop": minor
---

feat(desktop): retire the NDJSON chat store — the runner's log is the sole chat history

The final step of the dual-history consolidation. The desktop's NDJSON chat
mirror is fully removed; the renderer reads and writes nothing of its own and
the runner's authoritative log is the single source of truth for chat history.

Removed:
- The renderer's NDJSON read fallback + double-write + per-slot history-source
  selection (`chat-store`), and the legacy localStorage→NDJSON migration. The
  store now pages history solely from the runner (`chat.loadHistory`); with no
  connected runner the transcript is empty until the runner attaches.
- The `chat.append` / `chat.loadSegment` / `chat.clearLog` / `chat.migrate` IPC
  commands + their validation + remote allow-list entries, the desktop host's
  `chat-log` NDJSON store, the runner-pool/startup seed-migrations, and the now
  unused `@moxxy/core` `seedSessionLog`. Only `chat.loadHistory` remains.
- "Clear conversation" / session deletion now reset/erase only the runner's log
  (`session.newSession` / `deleteSession`).

Legacy chats whose history lived ONLY in the old NDJSON mirror are intentionally
not migrated (the prior migration PRs moved opened/started chats into the runner;
this drops the rest). Active chats are unaffected — the runner has always written
their log.
