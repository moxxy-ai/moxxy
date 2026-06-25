---
name: loop-strategy-author
description: Build a new loop strategy and plug it in.
---

# Loop-strategy author — implement a `LoopStrategy`

A loop strategy turns one user prompt into one turn — possibly many provider calls and tool executions. The SDK contract:

```ts
interface ModeDef {
  readonly name: string;
  run(ctx: ModeContext): AsyncIterable<MoxxyEvent>;
}
```

`@moxxy/mode-default` is the reference (Claude Code-style: model emits `tool_use` → hook → permission → execute → loop). `@moxxy/mode-goal` (autonomous auto-approve loop) and `@moxxy/mode-deep-research` (plan queries → parallel subagents → cited synthesis) are the other two shipped shapes.

## Use the SDK's loop helpers — don't reimplement

`@moxxy/sdk` exports the bits both shipped strategies share:

```ts
import {
  collectProviderStream,      // runs onBeforeProviderCall, consumes the stream, returns
                              // { text, toolUses, stopReason, error }
  projectMessagesFromLog,     // event log → ProviderMessage[], optional system + trailing user text
  type CollectedToolUse,
  type StreamResult,
} from '@moxxy/sdk';
```

The shipped modes use these directly. A new mode that reimplements stream consumption will drift — and drift is what shipped the "a mode skips onBeforeProviderCall" class of bugs. Don't.

## `ModeContext` essentials

- `sessionId`, `turnId`, `model`, `systemPrompt`
- `provider` — the active `LLMProvider`
- `tools`, `skills` — registries
- `log` — read-only `EventLogReader`
- `emit(event)` — appends to the log AND notifies subscribers (this is how events reach the caller)
- `permissions` — the active `PermissionResolver` (may be a `DeferredPermissionResolver` from core)
- `hooks` — `dispatcher.dispatchToolCall`, `dispatchBeforeProviderCall`, `dispatchToolResult`, etc.
- `signal` — abort signal threaded through the whole turn
- `maxIterations` — optional cap; respect it

## Don't yield, do emit

Old habit: `yield event` inside the strategy generator.

Correct habit: `await ctx.emit(event)`. The runtime (`runTurn` in core) subscribes to the log with a `turnId` filter and surfaces every emitted event to the caller. The generator's yielded values are mostly cosmetic — **`emit` is the source of truth**.

This means helper functions (consume a provider stream, run a tool) can `await ctx.emit(...)` without being generators. The SDK's `collectProviderStream` follows this pattern.

## Permission + hook flow (mode-default pattern, copy it)

For each model-emitted tool call:

```ts
// 1. dispatch onToolCall — hook may deny or rewrite
const verdict = await ctx.hooks.dispatchToolCall({
  sessionId: ctx.sessionId, cwd: '', log: ctx.log, env: {},
  turnId: ctx.turnId, iteration,
  call: { callId, name: t.name, input: t.input },
});
let actualInput = t.input;
if (verdict.action === 'rewrite') actualInput = verdict.input;
if (verdict.action === 'deny') { /* emit denied + result, continue */ }

// 2. PermissionResolver
const decision = await ctx.permissions.check(
  { callId, name: t.name, input: actualInput },
  { sessionId: String(ctx.sessionId), toolDescription: ctx.tools.get(t.name)?.description },
);
if (decision.mode === 'deny') { /* emit denied + result, continue */ }

// 3. emit approved → execute → emit result
await ctx.emit({ type: 'tool_call_approved', ..., decidedBy: 'resolver', mode: decision.mode });
try {
  const output = await ctx.tools.execute(t.name, actualInput, ctx.signal, {
    callId: t.id, sessionId: String(ctx.sessionId), turnId: String(ctx.turnId), log: ctx.log,
  });
  await ctx.emit({ type: 'tool_result', ..., callId, ok: true, output });
} catch (err) {
  const kind = ctx.signal.aborted ? 'aborted' : 'threw';
  await ctx.emit({ type: 'tool_result', ..., callId, ok: false, error: { kind, message: err.message } });
}
```

If you skip `dispatchToolCall`, plugin gating is silently disabled for your mode. (This is the parity bug class that the audit caught before these were folded down to the three shipped modes.)

## Abort

Check `ctx.signal.aborted` at every iteration entry. On abort, emit an `abort` event and return cleanly:

```ts
if (ctx.signal.aborted) {
  await ctx.emit({ type: 'abort', sessionId: ctx.sessionId, turnId: ctx.turnId,
                   source: 'system', reason: 'signal aborted' });
  return;
}
```

## Termination

End the strategy by `return`ing from `run`. Don't throw — capture errors with `await ctx.emit({ type: 'error', kind: 'fatal'|'retryable', ... })`.

## Plug in

```ts
import { defineMode, definePlugin } from '@moxxy/sdk';

export default definePlugin({
  name: '@moxxy/mode-<name>',
  modes: [defineMode({ name: 'my-mode', run: myRunFn })],
});
```

To select your mode: `session.modes.setActive('my-mode')`. If yours is the first registered, it becomes the default (mode/compactor registries auto-activate on first register).

## Don't

- **Don't reimplement `collectProviderStream` or `projectMessagesFromLog`** — import them from `@moxxy/sdk`.
- **Don't skip `dispatchToolCall`** — that silently breaks plugin gating.
- **Don't subscribe to `session.log` directly inside the strategy.** Use `ctx.log.slice()` (synchronous read of the current state). Subscribing creates a leak you'd have to unwind on abort.
- **Don't compute a high-water mark by hand** when calling the compactor — `Compactor.compact` already honors prior `CompactionEvent.replacedRange` (loop calls it; compactor decides).
- **Don't assume `ctx.cwd` / `ctx.env` exist on `ModeContext`.** They don't — the dispatcher pulls those from `AppContext` separately. Pass `cwd: ''`, `env: {}` to `dispatchToolCall` (mode-default does this).
