---
name: tool-author
description: Add one tool to a plugin. Schema, permission, handler, test.
---

# Tool author — add one tool

A tool is `defineTool({ name, description, inputSchema, permission?, handler, outputSchema? })`. The registry parses input via `inputSchema` before calling the handler, so your handler receives a fully-typed value.

## Anatomy

```ts
import { defineTool, z } from '@moxxy/sdk';

export const greetTool = defineTool({
  name: 'greet',
  description: 'Greet someone by name.',   // shown to the model
  inputSchema: z.object({
    name: z.string().min(1).describe('Who to greet.'),
    enthusiasm: z.number().int().min(0).max(5).optional().default(1),
  }),
  permission: { action: 'prompt' },        // allow | deny | prompt
  outputSchema: z.string(),                // optional — parsed before return
  handler: async ({ name, enthusiasm }, ctx) => {
    if (ctx.signal.aborted) throw new Error('aborted');
    return `Hello, ${name}${'!'.repeat(enthusiasm)}`;
  },
});
```

## Required discipline

- **Strict input schema.** No `z.any()` or `z.unknown()` at the top level. The schema is what the model sees in the tool spec; loose schemas waste tokens and produce flaky calls.
- **One sentence description.** This is the first thing the model reads. Lead with the verb.
- **Always respect `ctx.signal`.** Long-running tools (Bash, network) must check `signal.aborted` periodically; tools with their own subprocess (Bash) should also pipe abort → SIGTERM/SIGKILL.
- **Use `ctx.cwd` not `process.cwd()`.** Cwd is per-session.
- **Permission default.** Anything with side effects (Write, Bash, network): `{ action: 'prompt' }`. Read-only tools (Read, Glob, Grep) also use `prompt` by default — let the resolver decide.
- **Path handling.** For filesystem tools, use `resolvePath(ctx.cwd, target)` from `@moxxy/tools-builtin/src/util` (or wrap with `resolveWithinCwd` if you want strict containment). The function name `resolveSafe` is kept as a deprecated alias; new code uses `resolvePath`. Real safety against unintended fs access lives at the permission layer, not the resolver.
- **No path-traversal sandboxes for the sake of it.** Adding `..` rejection by default breaks legitimate workflows ("read ~/.bashrc"). Only use `resolveWithinCwd` when the tool's *contract* is "inside cwd only."

## Hook ordering before your handler runs

For every tool call the loop strategy does:

1. Emit `tool_call_requested` event.
2. `dispatcher.dispatchToolCall(ctx)` — plugin `onToolCall` hooks (deny/rewrite).
3. `PermissionEngine.check(call)` — file policy at `~/.moxxy/permissions.json`.
4. `session.resolver.check(call)` — interactive resolver / allow-list / deny-by-default.
5. Emit `tool_call_approved` → `tools.execute(name, input, signal, opts)`.
6. Emit `tool_result` → `dispatcher.dispatchToolResult` (plugins can rewrite).

Your handler is step 5 (`execute`). By the time it runs, input is parsed, permission is granted, the signal is wired. Trust those guarantees and don't re-validate.

## Test pattern

```ts
import { describe, expect, it } from 'vitest';
import { asSessionId, asTurnId, asToolCallId } from '@moxxy/sdk';
import { greetTool } from './greet.js';

const ctx = {
  sessionId: asSessionId('s'), turnId: asTurnId('t'), callId: asToolCallId('c'),
  cwd: '/tmp', signal: new AbortController().signal,
  log: { length: 0, at: () => undefined, slice: () => [], ofType: () => [], byTurn: () => [], toJSON: () => [] },
  logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
};

describe('greet', () => {
  it('returns a greeting', async () => {
    expect(await greetTool.handler({ name: 'ada', enthusiasm: 2 }, ctx)).toBe('Hello, ada!!');
  });
});
```

For end-to-end (model invokes the tool): register the tool on a `Session`, drive a turn with a scripted `FakeProvider` that emits `tool_use_start` / `tool_use_end` for your tool, assert on `tool_result` events.

## Common bugs

- Forgetting `await` on async `handler` — the result becomes a Promise instead of the value.
- Using `inputSchema` defaults but typing the handler param as `T | undefined` — `z.output<S>` gives you the resolved type. `defineTool` already wires this; if you see `undefined` where a default should apply, you're fighting zod.
- Returning structured data without `outputSchema` — the model receives `JSON.stringify(value)`. For complex outputs add `outputSchema` for type-safety, but for the model just consider returning a formatted string.
- Spawning child processes without a SIGKILL escalation. If `ctx.signal.aborted` fires, send SIGTERM, then SIGKILL after ~2s if the child hasn't exited. See `tools-builtin/src/bash.ts` for the pattern.
- Reading the full file when only a slice is needed — for huge files this OOMs. Stream by line or stat-cap first.

## Don't

- **Don't catch and discard `ctx.signal.aborted`.** Propagate as an error; the loop strategy will emit a `tool_result` with `error.kind: 'aborted'`.
- **Don't add ad-hoc permission checks** ("only allow paths under cwd"). The permission resolver is the single gate. Adding extra checks duplicates policy and makes the model's mental model of allowed/denied less predictable.
- **Don't write to a file without `tmp + rename`.** A crash mid-write corrupts whatever you were writing. (Vault, permissions, memory all follow this.)
