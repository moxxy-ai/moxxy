---
"@moxxy/core": minor
"@moxxy/desktop": minor
---

feat(desktop): migrate legacy NDJSON-only chats into the runner's authoritative log

The keystone of the dual-history consolidation: make the runner's session log the
home of EVERY chat, including ones whose history previously lived only in the
desktop's NDJSON mirror (localStorage-migrated / pre-runner-session chats). Without
this, continuing such a chat would strand its old history in NDJSON while new turns
go to the runner log — a split the per-slot single-source renderer can't show.

- `@moxxy/core` gains `seedSessionLog(sessionId, events, dir?)` — writes a fresh
  session JSONL from an event list IFF the session has none yet (idempotent;
  never overwrites a session the runner already owns), re-sequenced to contiguous
  `seq` 0..n-1 with ids/content preserved and written temp+rename.
- The desktop runner pool seeds a workspace's session from its NDJSON mirror
  (`seedChatIntoSession`) BEFORE that workspace's runner resumes its session id,
  so the seed is in place when the runner reads it (race-free) and only for chats
  actually opened. Best-effort and non-destructive — the NDJSON store is left
  intact and remains the read fallback.

This unblocks (and is a prerequisite for) the deferred follow-ups — stopping the
NDJSON double-write, raising the desktop FLOOR to v10, and retiring the NDJSON
store — each of which is a separate PR gated on packaged-desktop live-verify.
