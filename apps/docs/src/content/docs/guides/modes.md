---
title: Modes
description: Plan, work, automate, or research — when to use each mode.
---

A mode decides how a user turn unfolds: which tools are available, how
many provider calls run, and what ends the turn. The CLI includes the
two everyday modes (`default` and `plan`); autonomous `goal` and
fan-out `research` install only when you need them.

| Mode | Package | What it does |
|---|---|---|
| `default` | `@moxxy/mode-default` | Claude-Code-style: call provider, run any tools it asked for, feed results back, repeat until the model emits a final `assistant_message`. |
| `plan` | `@moxxy/mode-plan` | Read-only analysis: inspect the workspace and recalled context, then produce a detailed plan that can be revised before execution. |
| `goal` | `@moxxy/mode-goal` | Autonomous auto-approve loop. Runs across many turns with tools auto-approved until the model calls `goal_complete`. |
| `research` | `@moxxy/mode-deep-research` | Fan-out research: plan a set of queries → run them across parallel subagents → synthesize a cited answer. |

## default

The default. Best for everything that's well-scoped: "edit this file",
"run this query", "find that bug".

```ts
session.modes.setActive('default');
```

## plan

Use `plan` before broad, ambiguous, or high-risk work. It can inspect
files, search the workspace, load a skill, and recall earlier session or
long-term memory. It cannot execute commands or modify state.

Each turn ends with one implementation-ready plan: objective,
assumptions, open decisions, dependency-ordered steps, verification,
risks, and a recommended execution mode. Stay in `plan` and reply with
feedback to replace it with a revised plan.

When the plan is approved:

- `/mode default` keeps implementation supervised.
- `/goal Execute the approved plan above.` starts autonomous execution
  and offers to install goal mode if it is not present yet.

Switch to planning with `/mode plan` or cycle to it with Shift+Tab.

## goal

An autonomous loop for "just get it done" requests. Tools are
auto-approved and the loop continues across many turns until the model
calls the `goal_complete` tool with a summary and supporting evidence.

Use `goal` when you want the agent to drive end-to-end without a
human in the approval loop. Because tools are auto-approved, scope it
carefully (e.g. via `allowedTools` or a sandbox).

Switch to it from the TUI / Telegram with `/mode goal`.

## research

Designed for open-ended questions where the answer lives across many
sources. The mode plans a set of queries, fans them out to parallel
subagents, and synthesizes the gathered evidence into a single cited
answer.

Use `research` when one focused loop would be too shallow — comparisons,
literature scans, "find everything about X" requests.

Switch to it from the TUI / Telegram with `/mode research`.

## Switching

Per session:

```ts
session.modes.setActive('goal');
```

From the TUI / Telegram chat:

```
/mode default
/mode plan
/mode goal
/mode research
```

Per sub-agent (the parent stays on `default`):

```text
dispatch_agent({ prompt: "...", mode: "research" })
```

## Writing your own

`defineMode({ name, run })` from `@moxxy/sdk`. `run` is an
async generator that yields `MoxxyEvent`s. The simplest possible loop
is "one provider call, no tools, terminate" — the shipped
modes are layered orchestration on top of that primitive.

See `packages/mode-default/src/turn-iterator.ts` for the canonical
example.
