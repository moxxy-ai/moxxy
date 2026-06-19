---
title: '@moxxy/mode-deep-research'
description: Fan-out research mode — plan queries, run parallel subagents, synthesize a cited answer.
---

`@moxxy/mode-deep-research` decomposes the user's question into a set
of parallel sub-queries, fans them out via subagents, and synthesizes
the gathered evidence into a single cited writeup. Best for open-ended
questions whose answer lives across many sources.

The mode is registered under the name `research`.

## Install

```sh
pnpm add @moxxy/mode-deep-research
```

## Use

```ts
import { deepResearchModePlugin } from '@moxxy/mode-deep-research';

session.pluginHost.registerStatic(deepResearchModePlugin);
session.modes.setActive('research');
```

Switch interactively with `/mode research`.

## Exports

- `deepResearchMode` — the `ModeDef`.
- `deepResearchModePlugin` — the `Plugin` you register.
- `RESEARCH_MODE_NAME` — the registered name (`'research'`).
- `parseQueries`, `parseFollowups` — parsers used by the planning phase.

## See also

- [Modes guide](../guides/modes.md) — comparison + switching.
- [Sub-agents](../guides/subagents.md) — `dispatch_agent({ mode: 'research' })`.
