---
title: '@moxxy/mode-plan'
description: Read-only, revisable planning before supervised or autonomous execution.
---

`@moxxy/mode-plan` turns a request into an implementation-ready plan
without performing the work. It can inspect the workspace, load skills,
and recall relevant context, but exposes no mutating tools.

The moxxy CLI registers it by default. Framework embedders can install
and register the package directly.

## Install

```sh
pnpm add @moxxy/mode-plan
```

## Use

```ts
import { planModePlugin } from '@moxxy/mode-plan';

session.pluginHost.registerStatic(planModePlugin);
session.modes.setActive('plan');
```

Switch interactively with `/mode plan` or Shift+Tab.

## Contract

- Read-only tools only: workspace inspection, recall, memory lookup,
  skill loading, and web reads when installed.
- `plan_complete` validates the structure before the plan is rendered.
- The mode stays active across turns, so the next message revises the
  current plan instead of executing it.
- The rendered handoff recommends `default` for supervised work or
  `goal` only for bounded, safely verifiable work.

## Exports

- `planMode` — the `ModeDef`.
- `planModePlugin` — the `Plugin` you register.
- `PLAN_MODE_NAME` — the registered name (`'plan'`).
- `planDefinitionSchema` / `PlanDefinition` — the structured plan contract.
- `formatPlan` — the canonical Markdown presenter.

## See also

- [Modes guide](../guides/modes.md) — planning and execution paths.
- [Memory guide](../guides/memory.md) — session recall vs long-term memory.
