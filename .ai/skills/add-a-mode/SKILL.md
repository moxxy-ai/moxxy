---
name: add-a-mode
description: Build a new mode (loop strategy) package like default/goal/research — use when adding a new agentic-loop behavior.
---

# Add a mode

Full workflow: **`.claude/agents/loop-strategy-author.md`**. Existing modes:
`mode-default` (ReAct), `mode-goal` (autonomous auto-approve, one-shot),
`mode-deep-research` (fan-out + synthesis). The FIRST registered mode
auto-activates — registration order in `packages/cli/src/setup/builtins.ts`
matters.

Checklist:
- `defineMode({ name, run })` in a new `packages/mode-<name>/` package
  (add-a-plugin skill for scaffolding/wiring).
- **Build on `runReactLoop`** (`sdk/src/mode/react-loop.ts`) — do not hand-roll
  the loop: it owns provider retry back-off, reactive compaction, elision,
  stuck detection, abort handling, and the turn-end checkpoint gate
  (`TurnCheckpoint`). Your mode contributes POLICY via hooks
  (`onIterationStart` / `onProviderSuccess` / `onToolBatchEnd` /
  `onMaxIterations`) and checkpoints. Mirror `mode-goal`/`mode-default`.
- **Stuck-loop policy**: `stuck.action: 'abort'` (default — attended modes) vs
  `'nudge'` (unattended modes: the trip warns + steers with a volatile nudge,
  never kills the run — goal-mode lesson: near-repeat heuristics trip on
  legitimate edit→build→test cycles).
- **Unattended / per-objective modes**: set `transient: true` on the ModeDef —
  it is then never persisted as the boot/category default, and your loop should
  hand back via `ctx.requestModeSwitch(ctx.previousModeName ?? 'default')` when
  the objective concludes. Do NOT have channels flip session-wide
  yolo/auto-approve for your mode; swap a run-scoped permission resolver
  instead (see `runGoalMode`).
- **Auto-approve must still consult policy**: call the resolver's prompt-free
  `policyCheck` before allowing (A3, goal-mode lesson) — replacing the
  resolver with unconditional-allow discards the user's
  `~/.moxxy/permissions.json` deny rules.
- **Skip whitespace-only assistant messages** when emitting (A26) — empty text
  blocks wedge provider replays.
- Volatile per-iteration nudges: return them from `onIterationStart` (or
  checkpoint `inject` with `volatile: true`) — the loop wires
  `volatileTailCount` so they don't defeat the stable-prefix cache (A42).
- Checkpoint injection budget (`maxInjections`) is per idle-EPISODE — it resets
  whenever a tool batch executes, so it bounds no-progress wedges, not long
  productive runs.
- `zod` used at runtime ⇒ `dependencies`, not dev (A21).

Tests: mode packages have full loop tests with FakeProvider — mirror
`packages/mode-goal/src/*.test.ts` (incl. a deny-under-auto-approve case and,
for transient modes, revert/stay-armed coverage). Gate/checkpoint behavior:
`packages/mode-default/src/react-loop-gate.test.ts`.
