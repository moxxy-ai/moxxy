---
title: '@moxxy/mode-default'
description: Default Claude-Code-style loop — call provider, run tools, repeat until done.
---

`@moxxy/mode-default` is the default mode. The model calls
tools; the loop runs them and feeds results back; the model emits a
final `assistant_message` to stop. Best for everything well-scoped.

## Install

```sh
pnpm add @moxxy/mode-default
```

## Use

```ts
import { defaultModePlugin } from '@moxxy/mode-default';

session.pluginHost.registerStatic(defaultModePlugin);
session.modes.setActive('default');
```

## Exports

- `defaultMode` — the `ModeDef`.
- `defaultModePlugin` — the `Plugin` you register.
- `DEFAULT_MODE_NAME` — the registered name (`'default'`).
- `CollectedToolUse` — internal type re-exported for advanced wrappers.

## See also

- [Modes guide](../guides/modes.md) — comparison with `goal` and `research`.
