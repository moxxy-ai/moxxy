---
name: loop-strategy-author
description: Build a new loop strategy and plug it in.
---

# Loop-strategy author — implement a `LoopStrategy`

A loop strategy turns one user prompt into one turn — possibly many provider calls and tool executions. The contract is in `@moxxy/sdk`:

```ts
interface LoopStrategy {
  name: string;
  run(ctx: LoopContext): AsyncIterable<MoxxyEvent>;
}
```

`@moxxy/loop-tool-use` is the reference (Claude Code-style: model emits `tool_use` → permission → execute → loop). `@moxxy/loop-plan-execute` is the alternate shape (emit a plan event, then run inner micro-loops per step).

## `LoopContext` essentials

- `sessionId`, `turnId`, `model`, `systemPrompt`
- `provider` — the active `LLMProvider`
- `tools`, `skills` — registries
- `log` — read-only `EventLogReader`
- `emit(event)` — appends to the log AND notifies subscribers (this is how events reach the caller)
- `permissions` — the `PermissionResolver`
- `hooks` — dispatch lifecycle hooks (`dispatchToolCall`, `dispatchBeforeProviderCall`, etc.)
- `signal` — abort signal
- `maxIterations` — optional cap; respect it

## Don't yield, do emit

Old habit: `yield event` inside the strategy generator.

Correct habit: `await ctx.emit(event)`. The runtime (`runTurn` in core) subscribes to the log and surfaces every emitted event to the caller. The generator's return value is irrelevant — you can `yield` for compatibility, but **`emit` is the source of truth**.

This means helpers (consume a provider stream, run a tool) can `await ctx.emit(...)` without being generators. Much cleaner.

## Termination

End the strategy by `return`ing from `run`. Don't throw — capture errors with `await ctx.emit({ type: 'error', kind: 'fatal'|'retryable', ... })` and decide based on `kind`.

## Hook integration

- Before each provider call: `const transformed = await ctx.hooks.dispatchBeforeProviderCall(req, turnCtx);` then stream against `transformed`.
- Before each tool execution: `const verdict = await ctx.hooks.dispatchToolCall(toolCtx);` then check `verdict.action`.
- After each tool result: `const rewritten = await ctx.hooks.dispatchToolResult(resultCtx);` (loop-tool-use does this implicitly; check before adopting if you skip).

## Permission flow

```ts
const decision = await ctx.permissions.check(call, { sessionId, toolDescription });
if (decision.mode === 'deny') { /* emit denied + result, continue */ }
```

## Abort

Check `ctx.signal.aborted` at every iteration entry and before/after each provider call and tool execution. On abort, emit an `AbortEvent` and return.

## Plug in

```ts
import { defineLoopStrategy, definePlugin } from '@moxxy/sdk';

export default definePlugin({
  name: '@moxxy/loop-<name>',
  loopStrategies: [defineLoopStrategy({ name: 'my-loop', run: myRunFn })],
});
```

To select your strategy: `session.loops.setActive('my-loop')`. If yours is the first registered, it becomes the default.
