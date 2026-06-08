---
"@moxxy/cli": patch
"@moxxy/desktop": patch
"@moxxy/desktop-host": patch
"@moxxy/desktop-ipc-contract": patch
---

Desktop: resume a workspace's conversation + model context across app
restarts, and make `/new` actually start a fresh session.

The desktop owns and kills its `moxxy serve` child on quit, and each launch
spawned a bare `serve` that minted a brand-new empty session — so the model
forgot the whole conversation and the transcript collapsed to just the
post-restart message (the TUI didn't have this because its long-lived daemon
survives a window close). Now each per-workspace runner is given a sticky
session id (its desk id) so it resumes `~/.moxxy/sessions/<id>.jsonl` if present
and starts fresh under that id on first run.

- New `SetupOptions.sessionId` / `BuildSessionArgs.sessionId`: "resume-if-present"
  (distinct from `resumeSessionId`, which errors when the log is missing — for
  an explicit `moxxy resume <id>`).
- `serve` reads `MOXXY_SESSION_ID`; the desktop `RunnerSupervisor`/`RunnerPool`
  pass the workspace's desk id through to it.
- Renderer: the runner replays its FULL history on every attach (and re-attach
  after a reconnect), so the chat runtime now de-dupes ingested events by id
  (`seenIds`, kept in lockstep across live append, replay, and pagination). This
  makes a resumed replay idempotent and also fixes a latent bug where a transient
  reconnect to a still-alive runner could duplicate the transcript.
- `/new` now works on its own (previously it did nothing in the desktop — only
  `/clear` was handled). It clears the transcript AND resets the runner via a
  new `session.newSession` IPC → `RunnerSupervisor.resetSession()`, which wipes
  the persisted session log and restarts so the model context truly resets and
  doesn't resurrect on the next launch.
