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
- **Cap declarations on input** — `checkAllCaps` from `@moxxy/plugin-security` validates input against `fs` / `net` declarations before spawning.
- **Brokered `ctx.fs.readFile`** — handlers that opt in get every read re-validated against `caps.fs.read` on the parent side via an RPC channel. The syscall happens on the parent; the worker only sees the result.
- **Brokered `ctx.fetch`** — handlers that opt in get every URL re-validated against `caps.net` on the parent side. The socket opens on the parent.

## The broker RPC

Worker → Parent on `postMessage`:
- `{ type: 'broker-request', id, op, args }`

Parent → Worker:
- `{ type: 'broker-response', id, ok: true, value }`
- `{ type: 'broker-response', id, ok: false, errorName, errorMessage }`

Terminal:
- Worker → Parent: `{ type: 'result', ok, value | error... }`

Supported ops (see `src/broker.ts`):
- `fs.readFile(path, { encoding? })` — validated against `caps.fs.read`
- `fetch(url, init?)` — validated against `caps.net`

The op set is intentionally narrow. Adding `writeFile`, `readdir`,
`stat`, or `child_process` means extending the broker boundary —
a deliberate decision, not an ergonomic afterthought.

## What it does NOT enforce (yet)

- **Direct `node:fs` / `node:child_process` imports** — the broker is
  advisory. A handler that `import('node:fs')` and reads anywhere is
  not mediated. A loader-hook layer to block these imports is on the
  Phase 2.2+ roadmap; Node currently lacks a stable API for it.
- **Other fs ops** — only `readFile` is brokered today.
- **Env mediation** — `process.env` is inherited from the parent.

These are documented gaps, not bugs. Pick `worker` when the marginal
cost of a worker_threads boundary buys you something — memory caps,
fast termination, JS-state isolation, mediated reads/fetches. If your
threat model assumes a fully-adversarial handler, you need a
subprocess or container boundary, which the same `Isolator` interface
will host when implemented.

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

- [`.claude/agents/isolator-author.md`](https://github.com/moxxy-ai/moxxy/blob/main/.claude/agents/isolator-author.md) — author guide for new isolators
- [Security & isolation guide](/guides/security/) — user-facing overview
- [`@moxxy/plugin-security`](./plugin-security.md) — the host plugin
