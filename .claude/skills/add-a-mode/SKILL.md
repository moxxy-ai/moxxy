---
name: add-a-mode
description: Build a new mode (loop strategy) package like default/goal/research — use when adding a new agentic-loop behavior.
---

# Add a mode

Full workflow: **`.claude/agents/loop-strategy-author.md`**. Existing modes:
`mode-default` (ReAct), `mode-goal` (autonomous auto-approve), 
`mode-deep-research` (fan-out + synthesis). The FIRST registered mode
auto-activates — registration order in `packages/cli/src/setup/builtins.ts`
matters.

Checklist:
- `defineMode({ name, run })` in a new `packages/mode-<name>/` package
  (add-a-plugin skill for scaffolding/wiring).
- **Compose the SDK loop helpers** — do not hand-roll the tool batch loop:
  `executeToolUses` + `emitRequestsAndDetectStuck` (`sdk/src/tool-dispatch.ts`,
  parameterized by your `StuckLoopReport`) carry the load-bearing
  orphaned-tool_call_requested fix; `collectProviderStream`,
  `projectMessagesFromLog`, `runSingleShotTurn` for the provider side.
- **Auto-approve must still consult policy**: call the resolver's prompt-free
  `policyCheck` before allowing (A3, goal-mode lesson) — replacing the
  resolver with unconditional-allow discards the user's
  `~/.moxxy/permissions.json` deny rules.
- **Skip whitespace-only assistant messages** when emitting (A26) — empty text
  blocks wedge provider replays.
- Volatile per-iteration nudges: mark them via
  `CacheStrategyContext.volatileTailMessageCount` so they don't defeat the
  stable-prefix cache (A42).
- Overflow → reactive compaction handling: copy the pattern from
  `mode-default`'s loop (currently per-mode by design).
- `zod` used at runtime ⇒ `dependencies`, not dev (A21).

Tests: mode packages have full loop tests with FakeProvider — mirror
`packages/mode-goal/src/*.test.ts` (incl. a deny-under-auto-approve case).
