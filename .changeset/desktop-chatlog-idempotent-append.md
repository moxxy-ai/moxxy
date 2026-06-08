---
"@moxxy/desktop": patch
---

Stop the desktop chat-log from growing without bound on every restart. The runner
replays a conversation's full event history to the renderer on each attach, and the
renderer re-appended every replayed event to its NDJSON mirror
(`~/.moxxy/chats/<workspace>.jsonl`), so the file grew by a complete copy of the
conversation per restart — which also shifted `loadSegment`'s line-index cursors and
corrupted scroll-up pagination. `appendEvents` is now idempotent by event id, so the
log keeps exactly one copy and its pagination cursors stay stable.
