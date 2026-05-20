---
name: isolator-author
description: Add a new security `Isolator` (worker_threads, subprocess, wasm, docker, …) behind `@moxxy/plugin-security`.
---

# Isolator author — extend `@moxxy/plugin-security`

`@moxxy/plugin-security` ships two isolators (`none`, `inproc`). New isolation
modes drop in behind the same SDK interface — no changes to the plugin or to
the hook wiring are required. This guide walks through writing one.

## The SDK contract

From `@moxxy/sdk` (`packages/sdk/src/isolation.ts`):

```ts
interface Isolator {
  readonly name: string;          // 'worker' | 'subprocess' | 'wasm' | …
  readonly strength: IsolationStrength;
  run(
    call: IsolatedToolCall,
    handler: (input: unknown) => Promise<unknown>,
    caps: CapabilitySpec,
    signal: AbortSignal,
  ): Promise<unknown>;
}

type IsolationStrength =
  | 'none' | 'inproc' | 'worker' | 'subprocess' | 'vm' | 'wasm' | 'docker';
```

Pick `strength` honestly — the plugin uses `ISOLATION_RANK` to compare it
against each tool's `isolation.required`. Claiming `'docker'` when you're a
worker is how you ship a CVE.

## Where the boundary is

`handler` is **already bound to the in-process ToolContext** when your
`run()` is called. The security plugin's `wrapWithIsolator` builds the
closure; you only see `(input) => Promise<output>`. So:

- **You decide whether `input` and `output` cross your boundary or whether
  the handler crosses too.** A `worker` isolator that just times the
  in-process call buys nothing over `inproc`. To actually isolate, you must
  re-invoke the *real* handler module on the other side of your boundary —
  which means the tool's handler has to be addressable as a module export,
  not just a closure. See [Marshalling handlers](#marshalling-handlers).
- **You enforce `caps`.** The `CapabilitySpec` is your only source of truth
  for what the handler is allowed to do. `inproc` validates `caps.fs` /
  `caps.net` against the input via `checkAllCaps`; reuse that helper from
  `@moxxy/plugin-security` when your isolator is in-process.
- **You honor `signal`.** Wire `signal.addEventListener('abort', …)` to
  whatever cancellation primitive your runtime exposes (`worker.terminate()`,
  `child.kill()`, `wasmInstance.abort()`, `docker stop`).

## Marshalling handlers

The hard part. Tool handlers today are JS closures captured at
`defineTool(...)` time:

```ts
defineTool({
  name: 'bash',
  handler: async (input, ctx) => { /* uses ctx.cwd, spawns sh */ },
});
```

That closure can't cross a worker/process/container boundary — it captures
identifiers, possibly bindings to native resources, and is not serializable.
For a real out-of-process isolator you need ONE of:

1. **Module-reference handlers.** Have the tool author also declare
   `handler.module: './bash.js'`, `handler.export: 'bashHandler'`. Your
   isolator imports that module on the other side and re-invokes the
   exported function. Requires an SDK shape change — coordinate with the
   `core-extender` agent before adding the field.
2. **RPC-shaped handlers.** Mirror what `@moxxy/plugin-mcp` does: the
   in-process handler is itself just `(input) => rpc.call(toolName, input)`,
   and the *real* work lives in a long-lived sidecar. Your isolator becomes
   the sidecar runner.
3. **Capability-broker handlers.** The handler crosses the boundary as
   bytes (e.g., wasm bytecode); your isolator instantiates a fresh module
   per call and proxies cap-allowed side effects (open file, fetch URL)
   back to the parent over an RPC channel. The parent re-validates against
   `caps` before executing.

Phase 1's `inproc` isolator dodges all of this — it runs the bound closure
in-process and only enforces `caps` via input validation. That's enough
for path/host guards but doesn't stop a malicious handler from doing
`import('node:fs').then(fs => fs.readFileSync('/etc/passwd'))`. Be honest
about the threat model your isolator addresses.

## Implementation skeleton

```ts
// packages/isolator-worker/src/index.ts
import { Worker, type WorkerOptions } from 'node:worker_threads';
import type { Isolator } from '@moxxy/sdk';
import { checkAllCaps } from '@moxxy/plugin-security';

export const workerIsolator: Isolator = {
  name: 'worker',
  strength: 'worker',
  async run(call, _handler, caps, signal) {
    // 1) Static input validation (reuse the inproc helpers — they're pure).
    const verdict = checkAllCaps(call.input, caps, call.cwd);
    if (!verdict.ok) throw new Error(`[security:worker] ${verdict.reason}`);

    // 2) Spawn the worker pointing at the tool's *module* (requires the
    //    module-reference handler shape — see "Marshalling handlers" above).
    const worker = new Worker(/* resolved module path */, {
      workerData: { input: call.input, caps, cwd: call.cwd },
      resourceLimits: {
        maxOldGenerationSizeMb: caps.memMb ?? 256,
        // worker_threads has no wall-clock limit; enforce via timer below.
      },
    } satisfies WorkerOptions);

    // 3) Wire abort + timeout.
    const onAbort = (): void => void worker.terminate();
    signal.addEventListener('abort', onAbort, { once: true });
    const timer = caps.timeMs ? setTimeout(() => worker.terminate(), caps.timeMs) : null;

    // 4) Collect the result over postMessage.
    try {
      return await new Promise<unknown>((resolve, reject) => {
        worker.once('message', resolve);
        worker.once('error', reject);
        worker.once('exit', (code) => {
          if (code !== 0) reject(new Error(`worker exited with code ${code}`));
        });
      });
    } finally {
      if (timer) clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      void worker.terminate();
    }
  },
};
```

## Ship as a peer package

Convention: isolators that aren't bundled with `@moxxy/plugin-security`
live in a sibling package named `@moxxy/isolator-<name>`. Users register
them by passing into `buildSecurityPlugin`:

```ts
// In a custom moxxy.config.ts or a userland boot script
import { buildSecurityPlugin } from '@moxxy/plugin-security';
import { workerIsolator } from '@moxxy/isolator-worker';

buildSecurityPlugin({
  config: { enabled: true, isolator: 'worker' },
  toolRegistry: session.tools,
  isolators: [workerIsolator],
});
```

The plugin's built-in `IsolatorRegistry` accepts the extras alongside the
shipped `none` + `inproc` — no other wiring needed.

## Tests

The isolator interface is pure, so unit tests don't need a Session.
Construct an `IsolatedToolCall`, supply a fake `handler`, assert the
promise resolves/rejects under each cap shape. Mirror the structure of
`packages/plugin-security/src/isolators/inproc.test.ts`:

```ts
it('rejects when net cap is violated', async () => {
  await expect(
    workerIsolator.run(
      { toolName: 'fetch', input: { url: 'https://evil.com' }, /* ... */ },
      async () => 'never',
      { net: { mode: 'allowlist', hosts: ['api.example.com'] } },
      new AbortController().signal,
    ),
  ).rejects.toThrow(/not in the tool's declared net allowlist/);
});

it('honors an external abort', async () => { /* … */ });
it('terminates on timeMs overrun', async () => { /* … */ });
```

Also write at least one **boundary** test: prove that something the
handler captures in-process (a module-scoped variable, a native handle)
is NOT visible inside your isolator. That's the test that justifies the
strength claim.

## Audit + status integration

`moxxy security isolators` and `moxxy security audit` read their data
from the `IsolatorRegistry` returned by `buildSecurityPlugin`. Your
isolator appears automatically once registered — no CLI changes needed.

## Don't

- **Don't claim strength you don't have.** A worker_threads isolator
  with no module-reference marshalling is essentially `inproc`. Either
  register as `'inproc'` or commit to the marshalling work.
- **Don't silently fall back.** If your isolator can't run (Docker
  daemon missing, wasm runtime not installed), throw with a clear
  reason. The plugin's hook denies the call cleanly; falling through to
  less-isolated execution defeats the purpose of opting in.
- **Don't extend `CapabilitySpec` in your isolator.** Add new fields to
  `@moxxy/sdk/src/isolation.ts` so every isolator sees the same shape.
  Per-isolator capability extensions fragment the surface and make tool
  declarations non-portable.
- **Don't reach into the registered tool list.** Your isolator receives
  a bound handler and a cap spec — that's the entire contract. Don't
  inspect `session.tools` or rewrite tool definitions; that's the
  plugin's job, not yours.
- **Don't bypass the abort signal.** A long-running handler that
  ignores `signal` strands a worker/container per stuck call. Every
  isolator must wire `signal → terminate`.
