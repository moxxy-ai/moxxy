# @moxxy/mode-goal

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
