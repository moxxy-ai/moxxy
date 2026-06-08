# @moxxy/desktop-host

## 0.0.8

### Patch Changes

- a2d551f: Desktop: resume a workspace's conversation + model context across app
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

- Updated dependencies [a2d551f]
  - @moxxy/desktop-ipc-contract@0.0.8

## 0.0.7

### Patch Changes

- Updated dependencies [b928391]
  - @moxxy/sdk@0.5.1
  - @moxxy/desktop-ipc-contract@0.0.7
  - @moxxy/plugin-stt-whisper-codex@0.0.7
  - @moxxy/plugin-vault@0.0.7
  - @moxxy/runner@0.0.7

## 0.0.6

### Patch Changes

- Updated dependencies [ad26425]
- Updated dependencies [e64aa0e]
  - @moxxy/sdk@0.5.0
  - @moxxy/desktop-ipc-contract@0.0.6
  - @moxxy/plugin-stt-whisper-codex@0.0.6
  - @moxxy/plugin-vault@0.0.6
  - @moxxy/runner@0.0.6

## 0.0.5

### Patch Changes

- Updated dependencies [b014c3a]
  - @moxxy/sdk@0.4.0
  - @moxxy/desktop-ipc-contract@0.0.5
  - @moxxy/plugin-stt-whisper-codex@0.0.5
  - @moxxy/plugin-vault@0.0.5
  - @moxxy/runner@0.0.5

## 0.0.4

### Patch Changes

- Updated dependencies [d362a6b]
  - @moxxy/sdk@0.3.0
  - @moxxy/desktop-ipc-contract@0.0.4
  - @moxxy/plugin-stt-whisper-codex@0.0.4
  - @moxxy/plugin-vault@0.0.4
  - @moxxy/runner@0.0.4

## 0.0.3

### Patch Changes

- Updated dependencies [0afd61d]
  - @moxxy/sdk@0.2.0
  - @moxxy/desktop-ipc-contract@0.0.3
  - @moxxy/plugin-stt-whisper-codex@0.0.3
  - @moxxy/plugin-vault@0.0.3
  - @moxxy/runner@0.0.3

## 0.0.2

### Patch Changes

- Updated dependencies [93d9a2d]
  - @moxxy/sdk@0.1.3
  - @moxxy/desktop-ipc-contract@0.0.2
  - @moxxy/plugin-stt-whisper-codex@0.0.2
  - @moxxy/plugin-vault@0.0.2
  - @moxxy/runner@0.0.2
