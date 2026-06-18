---
"@moxxy/cli": patch
"@moxxy/desktop": patch
---

Quality sweep, wave 2 (audit-driven, all gates green)

Continues the 2026-06-18 monorepo sweep (`.claude/audits/`). Behavior is
unchanged except for the documented bug fixes; every fix ships with a test.

- **Dedup/generics onto shared homes:** route home-path derivations through the
  SDK `moxxyHome`/`moxxyPath` (fixes a latent `MOXXY_HOME` mismatch), one shared
  `refreshAndStore` for OAuth, a shared external-store helper in client-core, and
  one-shot provider calls routed through the shared SDK collector.
- **Confirmed logic/correctness fixes (~50):** workflows (yaml block-scalar
  comment corruption, loop-exit determinism, hard-failure wave break, nested
  awaitInput, resume re-emit, sibling-name run resolution, paused-run reporting),
  desktop/client (SkillsView edit-clobber, command-palette dispatch, StrictMode
  double-IPC, ask-respond failure recovery, onboarding unhandled rejection, mic
  stream leak), and assorted fixes across core/cli/channels/providers/isolators.
