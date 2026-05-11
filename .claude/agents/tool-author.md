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
- **Always respect `ctx.signal`.** Long-running tools (Bash, network) must check `signal.aborted` periodically.
- **Use `ctx.cwd` not `process.cwd()`.** Cwd is per-session.
- **Permission default.** Anything with side effects (Write, Bash, network): `{ action: 'prompt' }`. Read-only tools (Read, Glob, Grep) also use `prompt` by default — let the resolver decide.

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
