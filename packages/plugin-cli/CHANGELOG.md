# @moxxy/plugin-cli

## 0.1.3

### Patch Changes

- cf2f651: Performance pack from the 2026-06-09 audit (A39–A42 + A42b): the TUI context meter caches its token estimate per log and folds in only new events instead of re-walking the entire event log (incl. JSON.stringify of every tool result) on every ~30Hz render; the desktop NDJSON chat log keeps a size/mtime-guarded line-offset index so scroll-up pages seek-read only their own byte range instead of re-reading and re-parsing the whole file per page; MemoryStore maintains its MEMORY.md index incrementally (no more O(N) re-read of every memory file per write) and gains a warn-only `maxMemories` soft cap (default 500 — no eviction, memories are user knowledge); goal mode declares its idle nudge as a volatile tail message and the stable-prefix cache strategy places its rolling tail breakpoint before volatile messages, so idle goal iterations re-read the cached prefix instead of paying a guaranteed-wasted cache write; and compactor-summarize now produces a real summary via the session's own provider/model (new optional `provider`/`model` on `CompactContext`), falls back to an honest, clearly-labeled head+tail digest when no provider is reachable, and reports `tokensSaved` from real character deltas instead of the fabricated `slice.length * 30`.
- Updated dependencies [cf2f651]
- Updated dependencies [cf2f651]
- Updated dependencies [cf2f651]
- Updated dependencies [cf2f651]
  - @moxxy/sdk@0.8.1
  - @moxxy/core@0.0.11
  - @moxxy/plugin-mcp@0.0.11
  - @moxxy/chat-model@0.0.11

## 0.1.2

### Patch Changes

- f3c798f: `/new` now truly resets the session everywhere (audit A10). New `session.reset` runner RPC (protocol v3) + optional `SessionLike.reset()` capability: the runner aborts in-flight turns and clears its authoritative event log; the log's new `EventLog.onClear` listeners broadcast a `session.reset` notification so every attached mirror clears in lockstep (re-arming seq-0 ingest instead of silently rejecting all further events) and truncate the persisted session JSONL so wiped history can't resurrect on `--resume` — fixing the same resurrection bug for local `/new`. The TUI and Telegram `/new` paths call `reset()` (falling back to `log.clear()` when the capability is absent) and report an error instead of claiming "history cleared" when the reset RPC fails.
- Updated dependencies [0326fb0]
- Updated dependencies [2e4bc37]
- Updated dependencies [f3c798f]
- Updated dependencies [0326fb0]
  - @moxxy/core@0.0.10
  - @moxxy/sdk@0.8.0
  - @moxxy/chat-model@0.0.10
  - @moxxy/plugin-mcp@0.0.10

## 0.1.1

### Patch Changes

- Updated dependencies [85f9b91]
  - @moxxy/sdk@0.7.0
  - @moxxy/chat-model@0.0.9
  - @moxxy/core@0.0.9
  - @moxxy/plugin-mcp@0.0.9

## 0.1.0

### Minor Changes

- fab0fb4: Update flows: a real `moxxy update`, a TUI "new version" nudge, and observable desktop self-update.

  - **CLI** — new `moxxy update` command: checks the npm registry, detects how the
    CLI was installed (npm/pnpm/yarn/bun, global or local), and runs the matching
    upgrade after a confirm. `--check`/`--dry-run` report-only, `--yes` to skip the
    prompt. Source checkouts get git advice instead of an install.
  - **TUI** — surfaces a newer published `@moxxy/cli` as a one-line, auto-dismissing
    banner and shows the running version in the status line. The check is cached
    (~12h) and fully non-blocking on startup. (Also fixes the `version` prop being
    dropped before it reached the view.)
  - **Desktop self-update** — the previously-silent fall-back-to-the-floor is now
    observable: a persistent boot-decision log under `<userData>/app/boot-log.json`,
    a reason for every gate that rejects a staged bundle, and a Settings → Dashboard
    → Diagnostics readout. The renderer's boot confirmation is hardened (retry +
    reported failure) so a flaky heartbeat can't make the boot-probe revert a
    healthy update. Adds the `app.updateDiagnostics` / `app.bootHeartbeatFailed` IPC.

## 0.0.8

### Patch Changes

- Updated dependencies [eac83e5]
  - @moxxy/sdk@0.6.0
  - @moxxy/chat-model@0.0.8
  - @moxxy/core@0.0.8
  - @moxxy/plugin-mcp@0.0.8

## 0.0.7

### Patch Changes

- Updated dependencies [b928391]
  - @moxxy/sdk@0.5.1
  - @moxxy/chat-model@0.0.7
  - @moxxy/core@0.0.7
  - @moxxy/plugin-mcp@0.0.7

## 0.0.6

### Patch Changes

- Updated dependencies [ad26425]
- Updated dependencies [e64aa0e]
  - @moxxy/sdk@0.5.0
  - @moxxy/chat-model@0.0.6
  - @moxxy/core@0.0.6
  - @moxxy/plugin-mcp@0.0.6

## 0.0.5

### Patch Changes

- Updated dependencies [b014c3a]
  - @moxxy/sdk@0.4.0
  - @moxxy/chat-model@0.0.5
  - @moxxy/core@0.0.5
  - @moxxy/plugin-mcp@0.0.5

## 0.0.4

### Patch Changes

- Updated dependencies [d362a6b]
  - @moxxy/sdk@0.3.0
  - @moxxy/chat-model@0.0.4
  - @moxxy/core@0.0.4
  - @moxxy/plugin-mcp@0.0.4

## 0.0.3

### Patch Changes

- Updated dependencies [0afd61d]
  - @moxxy/sdk@0.2.0
  - @moxxy/chat-model@0.0.3
  - @moxxy/core@0.0.3
  - @moxxy/plugin-mcp@0.0.3

## 0.0.2

### Patch Changes

- Updated dependencies [93d9a2d]
  - @moxxy/sdk@0.1.3
  - @moxxy/chat-model@0.0.2
  - @moxxy/core@0.0.2
  - @moxxy/plugin-mcp@0.0.2

## 0.0.1

### Patch Changes

- Updated dependencies [c4352f9]
  - @moxxy/sdk@0.1.0
  - @moxxy/core@0.0.1
  - @moxxy/plugin-mcp@0.0.1
