---
'@moxxy/desktop-host': patch
'@moxxy/mode-goal': patch
---

Audit wave 4 stability + packaging fixes:

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
