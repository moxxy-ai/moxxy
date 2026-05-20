---
title: '@moxxy/isolator-worker'
description: worker_threads-based Isolator for @moxxy/plugin-security. Memory + time + JS-state isolation.
---

`@moxxy/isolator-worker` implements the `Isolator` interface from
`@moxxy/sdk` using Node's `worker_threads`. Tools that declare a
`handlerModule` reference get re-imported in a fresh worker per call;
memory + time + abort are enforced at the boundary.

Registered by default in the `@moxxy/cli` builtin stack. Embedders
pass it in explicitly:

```ts
import { buildSecurityPlugin } from '@moxxy/plugin-security';
import { workerIsolator } from '@moxxy/isolator-worker';

buildSecurityPlugin({
  config: { enabled: true, isolator: 'worker' },
  toolRegistry: session.tools,
  isolators: [workerIsolator],
});
```

## Tunable defaults

```ts
import { createWorkerIsolator } from '@moxxy/isolator-worker';

const iso = createWorkerIsolator({
  defaultMemMb: 512,    // when caps.memMb is omitted
  defaultTimeMs: 30_000 // when caps.timeMs is omitted
});
```

## What it enforces

- **Memory** — `resourceLimits.maxOldGenerationSizeMb` from `caps.memMb`. V8 kills the worker on heap overrun.
- **Wall-clock** — `caps.timeMs` via `setTimeout` → `worker.terminate()`. Hard kill, not cooperative.
- **Abort** — parent's `ctx.signal` → `worker.terminate()`.
- **JS state isolation** — fresh module cache, globals, V8 heap. Main-thread closures are not visible in the worker. Module-scoped state in the main thread is not visible either (proved by the boundary test in this package's suite).
- **Cap declarations** — `checkAllCaps` from `@moxxy/plugin-security` validates input against `fs` / `net` declarations.

## What it does NOT enforce (yet)

- **Filesystem mediation** — the worker has full fs access. `caps.fs` is validated against input fields, not against actual syscalls. A malicious or buggy handler can `import('node:fs')` and read anything the parent process can.
- **Network mediation** — the worker can `fetch()` anywhere.
- **Env mediation** — the worker inherits `process.env`.

The next iteration (capability broker over a parent RPC channel) will mediate these. Same `Isolator` interface, same authoring shape.

## Tool authoring requirements

The handler must be addressable as a module + named export — closures
captured at `defineTool(...)` time don't cross thread boundaries.

```ts
// my-tool-handler.ts — pure module
export async function myToolHandler(input, ctx) { /* ... */ }

// my-tool.ts
import { defineTool, z } from '@moxxy/sdk';
import { myToolHandler } from './my-tool-handler.js';

export const myTool = defineTool({
  name: 'my_tool',
  inputSchema: z.object({ /* ... */ }),
  handler: myToolHandler,
  isolation: {
    capabilities: { timeMs: 30_000, memMb: 256 },
    handlerModule: {
      url: new URL('./my-tool-handler.js', import.meta.url).href,
      export: 'myToolHandler',
    },
  },
});
```

When a worker-bound call lacks `handlerModule`, the isolator denies
with a clear error — silently degrading to in-process execution would
defeat the strength claim.

## See also

- [`.claude/agents/isolator-author.md`](https://github.com/moxxy-ai/new_moxxy/blob/main/.claude/agents/isolator-author.md) — author guide for new isolators
- [Security & isolation guide](/guides/security/) — user-facing overview
- [`@moxxy/plugin-security`](./plugin-security/) — the host plugin
