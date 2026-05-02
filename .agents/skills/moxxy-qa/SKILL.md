---
name: moxxy-qa
description: Use when the user wants to run the Moxxy quality gate (tests + clippy + fmt + CLI tests) before a commit/PR, after a refactor, or to verify a change didn't regress anything. Triggers: "run the tests", "run qa", "check the gate", "are tests passing", "prepare for PR", "full test run".
---

# Moxxy Quality Gate

This skill runs the complete pre-commit quality gate for the moxxy-v4 workspace and produces a triage report.

## How to invoke

Delegate the run to the `moxxy-qa-runner` agent via the `Agent` tool. That agent owns the gate order, the failure-parsing logic, and the report format — do not re-implement it here.

```
Agent({
  subagent_type: "moxxy-qa-runner",
  description: "Run full quality gate",
  prompt: "Run the full gate (fmt check, clippy -D warnings, cargo test --workspace, CLI npm test). Report in the standard format — status, failures with file:line, next step. <add any scope narrowing the user asked for, e.g. 'only moxxy-runtime' or 'skip the CLI'>."
})
```

## When to narrow scope

If the user specified a crate (e.g. "run tests for moxxy-channel"), pass that narrowing in the prompt — the agent will skip the global passes it can't safely skip (fmt is cheap; it'll still run) and will run `-p moxxy-<crate>` for clippy and test.

If the user only touched the CLI (`apps/moxxy-cli/`), tell the agent to skip the Rust side entirely.

## When NOT to use this skill

- Running a single test file → just use `Bash` with `cargo test -p <crate> -- <filter>` directly, no agent needed.
- Debugging a known failure → use the Agent tool with a more targeted prompt, not this gate.
- Running ignored e2e tests (`--ignored`) → those need API keys and are not part of the default gate; handle them inline with user confirmation.

## Follow-up

After the report comes back, surface it to the user verbatim — don't summarize away the file:line refs. If the user then asks to fix the failures, route to the appropriate specialist agent:

| Failure area | Agent |
|---|---|
| `crates/moxxy-runtime/src/primitives/*` | `moxxy-primitive-author` |
| `crates/moxxy-channel/*` | `moxxy-channel-author` |
| `crates/moxxy-storage/*` or migration issues | `moxxy-storage-author` |
| `apps/moxxy-cli/*` | `moxxy-cli-author` |
| Other crates (gateway, core, vault) | fix inline — no dedicated specialist |
