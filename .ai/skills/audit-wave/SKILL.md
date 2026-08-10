---
name: audit-wave
description: Run the repo's audit→verify→fix-in-waves pattern (parallel area agents, adversarial verification, one PR per wave) — use for a deep quality/security pass or batch-fixing confirmed findings.
---

# Audit wave

The pattern that produced A1–A47 (all fixed across PRs #126–#133). Worked
example + method: `.claude/audits/main-audit-2026-06-09.md`.

## Audit pass
1. Pin a base sha; audit THAT, not a moving main.
2. Fan out parallel area auditors (one per subsystem: core, sdk, each plugin
   cluster, desktop, runner, CI/release…). Give every auditor the same scope,
   threat assumptions, and base sha.
3. **Adversarial verification:** every critical/high finding goes to an
   independent verifier explicitly instructed to REFUTE it (read the code,
   prove it can't happen). Expect a real refute rate (~5/19 in the 06-09
   audit) — unverified findings waste fix waves.
4. Write the report to `.claude/audits/<name>.md`: confirmed findings with
   file:line + blast radius + fix sketch; refuted findings WITH the refutation
   (so the next audit doesn't re-raise them); medium/low backlog.
5. Fix release blockers immediately. Put confirmed deferred work in the
   repository issue tracker with the evidence and owning subsystem.

## Fix waves
- Group confirmed findings into coherent waves (~4-8 items: by subsystem or
  theme), one worktree + branch + PR per wave (`git worktree add` under
  `.claude/worktrees/`).
- Within a wave, parallel fix agents are fine but serialize edits to shared
  files through the integrator.
- Each fix includes code, a pinning test, and the issue/report finding linked
  to the PR. Close an issue only when the pinning test proves the mechanism.
- Full gate per wave (run-the-gate skill) + changeset → PR → **merge on
  green before cutting the next wave's worktree** (waves often touch
  neighboring lines; stacking unmerged waves breeds conflicts).
- Release blockers (an A1-class regression) jump the queue as their own
  minimal PR.
