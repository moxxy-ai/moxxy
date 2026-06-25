---
name: bug-hunter
description: Reproduce, isolate, and fix bugs using the event log.
---

# Bug hunter — debug via the event log

The first asset for any bug is the event log. Every interaction is recorded. Three workflows:

## 1. Reproduce from a session log

If the user has a saved log under `~/.moxxy/sessions/<date>-<id>.jsonl`:

```ts
import { EventLog } from '@moxxy/core';
const lines = fs.readFileSync('session.jsonl', 'utf8').trim().split('\n');
const seed = lines.map((l) => JSON.parse(l));
const log = new EventLog(seed);

// inspect:
log.ofType('error');                     // every error event
selectMessages(log);                     // projected provider history
selectPendingToolCalls(log);             // requested but unresolved
selectCurrentTurn(log);                  // latest turnId
log.byTurn(turnIdYouCareAbout);          // just one turn
```

## 2. Isolate the failing turn

Pinpoint which event-seq the bug appears at. Common patterns:

- An `error` event with `kind: 'fatal'` → look at the preceding `tool_call_requested` for inputs, or the prior `provider_request` for the model state.
- A `tool_call_denied` followed by a stuck loop → check the resolver, the static policy at `~/.moxxy/permissions.json`, and any `onToolCall` hook that may have denied.
- A loop that exceeds `maxIterations` → look at the sequence of `tool_use` calls; the model is probably stuck retrying a tool that always errors.
- A `compaction` event followed by an assistant message that references compacted-away context → the compactor cut too aggressively, or the loop didn't honor the high-water mark.
- Events with `turnId` from a *different* turn than expected in an HTTP/multi-tenant context → run-turn subscriber isn't filtering by `turnId`.
- Vault/permissions/memory file corrupted → check tmp-rename atomicity wasn't bypassed somewhere.

## 3. Write a failing test

Reproduce the bug as a Vitest test using `@moxxy/testing`'s harness:

```ts
import { FakeProvider, toolUseReply, textReply, createFakeSession } from '@moxxy/testing';
import { defaultModePlugin } from '@moxxy/mode-default';
import { collectTurn } from '@moxxy/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineTool } from '@moxxy/sdk';

it('reproduces #N', async () => {
  const provider = new FakeProvider({
    script: [
      toolUseReply('Read', { file_path: '/missing.txt' }, 'c1'),
      textReply('I am stuck.'),
    ],
  });
  const session = createFakeSession({ provider });
  session.pluginHost.registerStatic(defaultModePlugin);
  session.tools.register(defineTool({
    name: 'Read',
    inputSchema: z.object({ file_path: z.string() }),
    handler: async () => { throw new Error('ENOENT'); },
  }));
  session.modes.setActive('default');

  const events = await collectTurn(session, 'read /missing.txt');
  // assert on events; the test should FAIL while the bug is live, PASS after the fix
});
```

Save the test under the package that owns the bug. For end-to-end issues, the loop or session package is usually right.

## Concurrency / shared-state bugs

Recurring shape, all caught by the audit pass and fixed:

- **EventLog subscribers from one runTurn() observed another's events** — fixed by filtering subscribers by `turnId` in `core/src/run-turn.ts`. If you see cross-talk in a new context (e.g., a new channel), check the subscriber predicate.
- **Vault concurrent `set()` loses writes** — serialize through a promise-chain mutex; persist via tmp+rename. Look for any new store that read-modifies-writes a whole file.
- **Plugin unload mid-turn** — in-flight tool calls retain closures, but the dispatcher's `entries` array gets reassigned. Snapshot before iterating; quiesce before unloading.
- **`onShutdown` / `onEvent` not firing** — they're only dispatched from `Session.close()` and `EventLog.subscribe → dispatcher.dispatchEvent` respectively. Make sure the wiring is intact.

## Useful selectors

```ts
import {
  selectMessages,           // projected provider messages (honors compactions + attachments)
  selectPendingToolCalls,   // requested but unresolved
  selectCurrentTurn,        // latest turnId
  type PendingToolCall,
} from '@moxxy/core';
```

(The previous bug-hunter file mentioned `findEvent`, `selectLoadedPlugins`, `isToolCallResolved`, `estimateTokens`, `selectActiveSkillIds`. These were deleted as dead exports — no consumers. If you need event-of-type lookup, use `log.ofType(type).find(predicate)`.)

## Common bug patterns

- **Type mismatch between zod input schema and handler param.** If you see `undefined` where a `.default()` should apply, you're inferring `z.input` not `z.output`. `defineTool` uses `z.output<S>`; don't override the handler param type.
- **Hook order surprises.** Plugins registered later run their hooks later (modulo topo sort by `dependsOn`). If a hook isn't firing as expected, register an `onEvent` plugin that logs everything and inspect.
- **Compaction projection.** Original events stay in the log forever. If you're reading raw events you'll still see compacted ones. Use `selectMessages` to get the projection the model sees.
- **Provider streaming hangs.** Check that `req.signal` is forwarded to the vendor SDK's abort plumbing. Polling `req.signal.aborted` between yields helps but doesn't close the socket.
- **Plugin not loading.** Check `package.json#moxxy.plugin.entry` resolves. Check `pnpm install` ran after creating the new package. Check the loader's jiti cache isn't stale (kill the process — the singleton is keyed by first-loader cwd).
- **`moxxy doctor` to triage.** Run it first; it walks config, vault, providers, channels, plugins, memory, skills.
