---
"@moxxy/desktop": minor
---

feat(desktop): read chat history from the runner's authoritative log (NDJSON kept as fallback)

The desktop renderer now reads transcript history from the runner instead of its
own NDJSON store, completing the renderer half of the dual-history consolidation
(the runner v10 `session.loadHistory` foundation shipped separately).

- New IPC `chat.loadHistory` proxies to the workspace's connected `RemoteSession`
  (`session.loadHistory`, protocol v10). It returns `null` — so the renderer
  falls back to the existing `chat.loadSegment` NDJSON path — whenever the runner
  can't serve it: no connected runner for the workspace, a `<v10` runner (the
  version gate throws), or a legacy-only chat that exists solely in
  `~/.moxxy/chats`. No transcript ever goes blank.
- `ChatPersistence.loadHistory` + a chat-store "page-until-K-rendered" cursor:
  the runner returns RAW events (including non-rendered `assistant_chunk`/
  provider bookends), so the store walks several raw pages and filters with
  `isRenderedEvent` until it has a full window of rendered rows. The history
  source (runner `seq` cursor vs NDJSON line-index cursor) is decided once per
  slot and never mixed; if the runner drops mid-scroll the slot stays resumable
  rather than switching cursor spaces.
- A GOLDEN render-equivalence test pins that runner-stream + `isRenderedEvent`
  reconstructs the EXACT same transcript as the NDJSON `loadSegment` path, across
  stream-without-seal, reasoning, tool, compaction, and multi-page fixtures.

The renderer still WRITES NDJSON (the double-write), so it remains a working read
fallback and the home of legacy-only chats. Stopping the double-write and
physically retiring the NDJSON store are deferred follow-ups, gated on a v10
floor and packaged-desktop live-verify.
