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
- Legacy completeness: a session whose runner log predates the seal feature can
  hold a turn that streamed text then errored/aborted with no `assistant_message`.
  The runner-read projection reconstructs that reply (mirroring the runner's own
  seal) so it is never silently dropped — but only for turns the runner never
  sealed, so a post-seal errored turn is not doubled.
- A GOLDEN render-equivalence test pins that the runner-read projection
  reconstructs the EXACT same transcript as the legacy NDJSON path — its ground
  truth is built by an independent pass of the real live reducer (not by
  re-applying the projection), across sealed, unsealed (reconstructed),
  errored-then-sealed (not doubled), reasoning, tool, plugin, compaction, and
  multi-page fixtures.

The renderer still WRITES NDJSON (the double-write), so it remains a working read
fallback and the home of legacy-only chats. Stopping the double-write and
physically retiring the NDJSON store are deferred follow-ups, gated on a v10
floor and packaged-desktop live-verify.
