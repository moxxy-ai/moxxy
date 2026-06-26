# @moxxy/mode-goal

## 0.0.37

### Patch Changes

- @moxxy/sdk@0.24.1

## 0.0.36

### Patch Changes

- Updated dependencies [f71c8bd]
  - @moxxy/sdk@0.24.0

## 0.0.35

### Patch Changes

- Updated dependencies [aec6e0e]
  - @moxxy/sdk@0.23.0

## 0.0.34

### Patch Changes

- Updated dependencies [48542df]
- Updated dependencies [f980349]
- Updated dependencies [1dc1697]
- Updated dependencies [069cd0e]
  - @moxxy/sdk@0.22.0

## 0.0.33

### Patch Changes

- @moxxy/sdk@0.21.1

## 0.0.32

### Patch Changes

- Updated dependencies [074f845]
- Updated dependencies [3a4b604]
  - @moxxy/sdk@0.21.0

## 0.0.31

### Patch Changes

- Updated dependencies [2ccd62e]
- Updated dependencies [9bff8a1]
- Updated dependencies [bddaa83]
- Updated dependencies [5c1c334]
- Updated dependencies [2ccd62e]
  - @moxxy/sdk@0.20.0

## 0.0.30

### Patch Changes

- Updated dependencies [08f927a]
  - @moxxy/sdk@0.19.0

## 0.0.29

### Patch Changes

- Updated dependencies [e4fe785]
  - @moxxy/sdk@0.18.0

## 0.0.28

### Patch Changes

- Updated dependencies [0d6df6e]
  - @moxxy/sdk@0.17.0

## 0.0.27

### Patch Changes

- Updated dependencies [648c966]
  - @moxxy/sdk@0.16.1

## 0.0.26

### Patch Changes

- Updated dependencies [b19d401]
  - @moxxy/sdk@0.16.0

## 0.0.25

### Patch Changes

- Updated dependencies [92fecb8]
  - @moxxy/sdk@0.15.2

## 0.0.24

### Patch Changes

- Updated dependencies [e762d40]
  - @moxxy/sdk@0.15.1

## 0.0.23

### Patch Changes

- Updated dependencies [cbf115b]
  - @moxxy/sdk@0.15.0

## 0.0.22

### Patch Changes

- Updated dependencies [50a5b38]
- Updated dependencies [50a5b38]
- Updated dependencies [50a5b38]
  - @moxxy/sdk@0.14.5

## 0.0.21

### Patch Changes

- Updated dependencies [897a1fc]
  - @moxxy/sdk@0.14.4

## 0.0.20

### Patch Changes

- Updated dependencies [5f20dab]
  - @moxxy/sdk@0.14.3

## 0.0.19

### Patch Changes

- Updated dependencies [091ef41]
  - @moxxy/sdk@0.14.2

## 0.0.18

### Patch Changes

- Updated dependencies [640d036]
  - @moxxy/sdk@0.14.1

## 0.0.17

### Patch Changes

- Updated dependencies [e1fb6a6]
- Updated dependencies [e1fb6a6]
  - @moxxy/sdk@0.14.0

## 0.0.16

### Patch Changes

- Updated dependencies [89ad994]
  - @moxxy/sdk@0.13.0

## 0.0.15

### Patch Changes

- Updated dependencies [33e9640]
- Updated dependencies [143264a]
- Updated dependencies [7366a09]
- Updated dependencies [951f374]
  - @moxxy/sdk@0.12.0

## 0.0.14

### Patch Changes

- Updated dependencies [aacdf1d]
  - @moxxy/sdk@0.11.0

## 0.0.13

### Patch Changes

- Updated dependencies [2796066]
  - @moxxy/sdk@0.10.0

## 0.0.12

### Patch Changes

- Updated dependencies [1e4ed09]
- Updated dependencies [4a8ec5d]
- Updated dependencies [6afc4c0]
  - @moxxy/sdk@0.9.0

## 0.0.11

### Patch Changes

- cf2f651: Performance pack from the 2026-06-09 audit (A39–A42 + A42b): the TUI context meter caches its token estimate per log and folds in only new events instead of re-walking the entire event log (incl. JSON.stringify of every tool result) on every ~30Hz render; the desktop NDJSON chat log keeps a size/mtime-guarded line-offset index so scroll-up pages seek-read only their own byte range instead of re-reading and re-parsing the whole file per page; MemoryStore maintains its MEMORY.md index incrementally (no more O(N) re-read of every memory file per write) and gains a warn-only `maxMemories` soft cap (default 500 — no eviction, memories are user knowledge); goal mode declares its idle nudge as a volatile tail message and the stable-prefix cache strategy places its rolling tail breakpoint before volatile messages, so idle goal iterations re-read the cached prefix instead of paying a guaranteed-wasted cache write; and compactor-summarize now produces a real summary via the session's own provider/model (new optional `provider`/`model` on `CompactContext`), falls back to an honest, clearly-labeled head+tail digest when no provider is reachable, and reports `tokensSaved` from real character deltas instead of the fabricated `slice.length * 30`.
- Updated dependencies [cf2f651]
- Updated dependencies [cf2f651]
- Updated dependencies [cf2f651]
- Updated dependencies [cf2f651]
  - @moxxy/sdk@0.8.1

## 0.0.10

### Patch Changes

- 05d643a: Audit wave 4 stability + packaging fixes:

  - `RunnerSupervisor.restart()` now uses the same graceful SIGTERM→SIGKILL
    termination (awaiting actual child exit) as every other teardown path,
    instead of a bare `child.kill()` + immediate respawn — closing the
    EADDRINUSE race where a quick restart collided with the dying `moxxy serve`
    still holding the runner socket.
  - `@moxxy/desktop-host` declares `@moxxy/core` as a real dependency (it
    imports `deleteSession` in prod source but had it under devDependencies) —
    the same missing-prod-dependency class of bug as the A1 packaged-desktop
    release blocker.
  - `@moxxy/mode-goal` declares `zod` as a real dependency (runtime import in
    `goal-tools.ts`, previously devDependencies-only).
  - (No version bump needed) `.github/workflows/release.yml`: the
    `desktop-v<version>` tag is now pushed only AFTER all installer builds
    succeed — builds check out a pinned sha, and `desktop-release` creates the
    tag + draft release together — so a failed desktop build no longer
    permanently burns the version.

- 2e4bc37: Goal-mode auto-approve now respects user permission policy (audit A3). `PermissionResolver` gains an optional prompt-free `policyCheck(call, ctx)` (implemented by core's policy wrapper) that returns the engine/tool-rule decision without ever falling through to an interactive prompt. Goal mode consults it before auto-allowing, so `~/.moxxy/permissions.json` deny rules now deny in unattended runs — previously the auto-approve resolver replaced the whole policy chain, silently ignoring them.
- Updated dependencies [0326fb0]
- Updated dependencies [2e4bc37]
- Updated dependencies [f3c798f]
- Updated dependencies [0326fb0]
  - @moxxy/sdk@0.8.0

## 0.0.9

### Patch Changes

- Updated dependencies [85f9b91]
  - @moxxy/sdk@0.7.0

## 0.0.8

### Patch Changes

- Updated dependencies [eac83e5]
  - @moxxy/sdk@0.6.0

## 0.0.7

### Patch Changes

- Updated dependencies [b928391]
  - @moxxy/sdk@0.5.1

## 0.0.6

### Patch Changes

- Updated dependencies [ad26425]
- Updated dependencies [e64aa0e]
  - @moxxy/sdk@0.5.0

## 0.0.5

### Patch Changes

- Updated dependencies [b014c3a]
  - @moxxy/sdk@0.4.0

## 0.0.4

### Patch Changes

- Updated dependencies [d362a6b]
  - @moxxy/sdk@0.3.0

## 0.0.3

### Patch Changes

- Updated dependencies [0afd61d]
  - @moxxy/sdk@0.2.0
