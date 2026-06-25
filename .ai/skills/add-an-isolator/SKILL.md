---
name: add-an-isolator
description: Add a capability Isolator implementation (worker/subprocess/wasm/docker-style) — use when extending the opt-in plugin-security isolation.
---

# Add an isolator

Full workflow: **`.claude/agents/isolator-author.md`**. Existing impls, in
increasing strength: `isolator-worker` (worker_threads: memory/time/JS-state),
`isolator-subprocess` (kernel process boundary), `isolator-wasm` (zero ambient
authority, experimental). `@moxxy/plugin-security` owns the `Isolator`
interface + the `none`/`inproc` baselines and the capability broker.

Checklist:
- Implement the `Isolator` interface from `@moxxy/plugin-security`; contribute
  it via `definePlugin({ isolators: [myIsolator] })` (PluginSpec.isolators →
  ContributedIsolatorRegistry → `session.isolators`).
- Register in `packages/cli/src/setup/builtins.ts` like the existing three.
- Isolation is **off by default** (opt-in per capability spec) — never make a
  new isolator the silent default.
- The broker gates exec allowlists and capability grants — keep all
  policy decisions in the broker, the isolator only ENFORCES a boundary.
- Time + memory limits must actually kill the workload (test both); a
  subprocess isolator must signal the whole process group (the A16 lesson).
- Audit CLI: `moxxy security audit` surfaces what's isolated — keep its
  output truthful for the new isolator.

Tests: each existing isolator package has boundary tests (state leakage,
timeout kill, denied capability) — mirror `isolator-worker/src/*.test.ts`.
