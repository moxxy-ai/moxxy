---
"@moxxy/cli": minor
"@moxxy/plugin-cli": minor
"@moxxy/desktop-ipc-contract": minor
"@moxxy/desktop-host": minor
"@moxxy/desktop": patch
---

Update flows: a real `moxxy update`, a TUI "new version" nudge, and observable desktop self-update.

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
