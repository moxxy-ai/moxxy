---
name: tech-debt-journal
description: Work the TECH_DEBT.md living journal correctly (read-before-work, retire ≥1 per change, log on sight) — use at the start and end of every non-trivial task.
---

# The tech-debt journal

`TECH_DEBT.md` is a LIVING JOURNAL, not an archive. Canonical rule: AGENTS.md →
"Tech debt is a standing job". The working loop:

1. **Before non-trivial work:** skim TECH_DEBT.md. Task touches an area with
   an open item → fold the fix into the work.
2. **Every shipped change retires ≥1 item** (or a quick win nearby). Move the
   retired entry's one-liner into the "Resolved ledger" — never just delete.
3. **Log new debt the moment you see it** — P1/P2/P3 section, concrete
   `file:line` evidence, severity. Debt you can't fix now still gets recorded
   now.
4. **Sizeable feature/refactor → re-audit the subsystem** you touched and
   refresh its items.

Conventions in the file:
- **A-intake** (`A1`, `A2`, …): confirmed audit findings awaiting/receiving
  fixes, numbered so `#1–#10` cross-refs stay stable. Fixed ones read
  "✅ FIXED (this PR): …" with the mechanism. Fold them into P-sections or the
  ledger as fixes land.
- **P1/P2/P3** = high/medium/low standing items; ⚠️ PARTIALLY DONE carries an
  explicit "Remaining:" scope.
- "Last refreshed" header line: update it on a full-pass refresh, with a
  one-paragraph summary of the pass.

Hazards:
- **Rebase TECH_DEBT.md against main BEFORE editing it on a long-lived
  branch** — it's the one file where a stale base silently lies (PRs #113/#115
  resurrected retired items). Merge rule: the ✅ side wins. See
  rebase-and-resolve skill.
- Append-only spirit: don't rewrite others' entries to say less; verify
  against code before un-retiring anything.
