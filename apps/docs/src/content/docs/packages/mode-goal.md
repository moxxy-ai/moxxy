---
title: '@moxxy/mode-goal'
description: Autonomous auto-approve loop — works across turns until goal_complete.
---

`@moxxy/mode-goal` runs an autonomous loop. State a goal once and the
agent works across many turns with tools auto-approved until it calls
the `goal_complete` tool (with a summary and supporting evidence) — or
`goal_abandon`. The loop is guarded by an iteration cap, a token
budget, a stuck-loop detector, no-progress detection, and the user's
abort.

Because tools run auto-approved, scope the run carefully — e.g. via
`allowedTools` or a sandbox.

## Install

```sh
pnpm add @moxxy/mode-goal
```

## Use

```ts
import { goalModePlugin } from '@moxxy/mode-goal';

session.pluginHost.registerStatic(goalModePlugin);
session.modes.setActive('goal');
```

Switch interactively with `/mode goal`.

## Exports

- `goalMode` — the `ModeDef`.
- `goalModePlugin` — the `Plugin` you register.
- `GOAL_MODE_NAME` — the registered name (`'goal'`).

## See also

- [Modes guide](../guides/modes.md) — comparison + switching.
- [Sub-agents](../guides/subagents.md) — `dispatch_agent({ mode: 'goal' })`.
