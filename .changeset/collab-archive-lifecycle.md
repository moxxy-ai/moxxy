---
"@moxxy/mode-collaborative": minor
"@moxxy/desktop-ipc-contract": minor
"@moxxy/desktop-host": minor
"@moxxy/desktop": minor
---

feat(collaborative): run archive/history + an always-available "End & archive"

Two gaps the user hit: a wedged/finished collaboration couldn't be ended (the
"＋ New" button only appeared once a run had completed, so a stuck run — or a
stale single-flight lock — left the Collaborate tab with no way forward), and
there was no record of past runs at all (the transient run dirs were even left
orphaned).

- **Run archive.** Every run is now persisted as a JSON record under
  `~/.moxxy/collab/runs/<runId>.json` on EVERY exit path (completed, aborted,
  failed) — task, brief, roster + per-agent status/summaries, board, contracts,
  merge result, and timings. New `@moxxy/mode-collaborative` archive API
  (`listRunRecords` / `readRunRecord` / `writeRunRecord`).
- **End & archive.** New `collab.end` IPC aborts the coordinator turn (its
  finally tears the team down + archives) and force-releases the global lock —
  so a stuck run or a stale lock can always be cleared. New
  `forceReleaseCollabLock()` + `SessionDriver.abortActiveTurns()`.
- **History view.** New `collab.history` IPC + a Collaborate-tab History list
  (outcome, task, agent counts, per-run detail with brief + summaries).
- The Collaborate header now always offers **End & archive** (while running or
  while a lock is held) and the "already running" banner gained an inline
  "end & archive it now" so a wedged run never blocks a fresh start.

Adds archive + force-release + abort tests, and the coordinator e2e test now
asserts the run is archived.
