---
"@moxxy/cli": patch
"@moxxy/sdk": patch
"@moxxy/desktop": patch
---

Close the cross-package hardening items deferred from the repo-wide sweep, with
regression tests:

- **Bugs:** `countNodes()` recursion → iterative (no RangeError on a deep AST);
  subagent `spawnAll` now settles all children (one child's setup failure no
  longer orphans its siblings); the runner socket path honors `$MOXXY_HOME`; the
  computer-control screenshot tool result is projected as a provider image block
  so the model can actually see screenshots; `MoxxyRequirement.version` narrowed
  to the plugin kind; `CompactorDef.compact` signature aligned; `isFileDiffDisplay`
  validation tightened.
- **DRY:** `sleepWithAbort` / `nextBackoffMs` extracted into `@moxxy/sdk` (shared by
  the default and goal modes); the isolator shim + broker-op concurrency limiter
  single-sourced in `@moxxy/plugin-security` and applied to both isolators; desktop
  loopback ports hoisted to one module; a shared collab-store helper extracted.
- **Accessibility / contract:** a global `prefers-reduced-motion` rule for inline
  transitions; real ARIA roles + roving focus + Escape + focus-restore on the
  anonymizer filter dropdown; zod schemas for the collab IPC channels.
