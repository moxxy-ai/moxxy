---
title: '@moxxy/isolator-subprocess'
description: Subprocess-based Isolator for @moxxy/plugin-security. Kernel-enforced process boundary; restricted env.
---

`@moxxy/isolator-subprocess` runs handlers in a separate Node child
process, communicating with the parent over stdin/stdout NDJSON. Same
broker protocol as `@moxxy/isolator-worker`; different transport and
a stronger boundary.

Registered by default in the `@moxxy/cli` builtin stack. Embedders
pass it in explicitly:

```ts
import { buildSecurityPlugin } from '@moxxy/plugin-security';
import { subprocessIsolator } from '@moxxy/isolator-subprocess';

buildSecurityPlugin({
  config: { enabled: true, isolator: 'subprocess' },
  toolRegistry: session.tools,
  isolators: [subprocessIsolator],
});
```

## Tunable defaults

```ts
import { createSubprocessIsolator } from '@moxxy/isolator-subprocess';

const iso = createSubprocessIsolator({
  defaultTimeMs: 30_000,                   // wall-clock budget when caps.timeMs omitted
  defaultEnvAllowlist: ['PATH', 'HOME'],   // env keys passed through when caps.env omitted
  nodePath: process.execPath,              // which Node binary to spawn
});
```

## What it enforces

- **Kernel-enforced process boundary** — separate virtual memory, file
  descriptor table, signal mask, credentials.
- **Restricted env** — the child sees only env keys listed in
  `caps.env` (or the default allowlist). Other vars are not inherited.
- **Wall-clock** — `caps.timeMs` via `setTimeout` → `child.kill('SIGTERM')`.
- **Abort** — parent's `ctx.signal` → `child.kill('SIGTERM')`.
- **Broker ops** — same surface as `worker`: `fs.{readFile,writeFile,readdir,stat}`, `fetch`, `exec`. Each call re-validated against caps on the parent side.

## What it does NOT enforce

- **Direct `node:fs` / `node:child_process` imports** inside the child
  still bypass the broker. Same advisory limit as the worker isolator.
  A loader-hook layer to block this is a future iteration.
- **No ulimit / cgroup / namespace setup** — the child is a regular
  Node process. If you need stronger sandboxing, use a wasm handler
  (no Node APIs at all) or wrap your tool binary in the OS-level
  sandbox of your choice.

## Performance characteristics

| | worker | subprocess |
|---|---|---|
| Startup | ~5–20ms | ~80–150ms |
| Memory | Shared V8 isolate pool | Fresh Node process |
| Termination | `worker.terminate()` (immediate) | `SIGTERM` (cooperative-ish) |
| Boundary | JS-level | OS-level |

The subprocess isolator is roughly an order of magnitude slower per
call than worker. Use it when the marginal isolation actually buys you
something — untrusted tool input, multi-tenant deployment, threat
models that need restrictable env.
