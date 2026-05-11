---
name: bug-hunter
description: Reproduce, isolate, and fix bugs using the event log.
---

# Bug hunter — debug via the event log

The first asset for any bug is the event log. Every interaction is recorded. Three workflows:

## 1. Reproduce from a session log

If the user has a saved log:

```ts
import { EventLog } from '@moxxy/core';
const seed = JSON.parse(fs.readFileSync('session.jsonl').toString().trim().split('\n').map(JSON.parse));
const log = new EventLog(seed);
// inspect: log.ofType('error'), selectMessages(log), selectPendingToolCalls(log)
```

## 2. Isolate the failing turn

Pinpoint which event-seq the bug appears at. Common patterns:

- An `error` event with `kind: 'tool_threw'` → look at the preceding `tool_call_requested` for inputs.
- A `tool_call_denied` followed by an `error` → check the resolver and the static policy.
- A loop that exceeds `maxIterations` → look at the sequence of `tool_use` calls; the model is probably stuck retrying a tool that always errors.
- A `compaction` event followed by an assistant message that references compacted-away context → the compactor cut too aggressively.

## 3. Write a failing test

Reproduce the bug as a Vitest test using `@moxxy/testing`'s harness:

```ts
import { FakeProvider, toolUseReply, textReply, createFakeSession } from '@moxxy/testing';
import { toolUseLoopPlugin } from '@moxxy/loop-tool-use';
import { collectTurn } from '@moxxy/core';

const provider = new FakeProvider({
  script: [
    toolUseReply('Read', { file_path: '/missing.txt' }, 'c1'),
    textReply('I am stuck.'),
  ],
});
const session = createFakeSession({ provider });
session.pluginHost.registerStatic(toolUseLoopPlugin);

const events = await collectTurn(session, 'read /missing.txt');
// assert on events; the test should FAIL while the bug is live, PASS after the fix
```

Save the test under the package that owns the bug. If it's an end-to-end issue, put it under `packages/loop-tool-use/src/<bug>.test.ts`.

## Useful selectors

```ts
import {
  selectMessages,           // projected provider messages
  selectPendingToolCalls,   // requested but unresolved
  selectActiveSkillIds,     // skills invoked this session
  selectLoadedPlugins,      // registered plugins
  isToolCallResolved,       // call closed by result or denial?
  findEvent,                // search by type + predicate
} from '@moxxy/core';
```

## Common bug patterns

- **Type mismatch between zod input schema and handler param.** If you see `undefined` where a `.default()` should apply, you're inferring `z.input` not `z.output`. `defineTool` already uses `z.output<S>`; check you're not declaring the handler param manually.
- **Hook order surprises.** Plugins registered later run their hooks later (modulo topo sort by `dependsOn`). If a hook isn't firing as expected, log every `onEvent` fanout and check ordering.
- **Compaction projection.** Original events stay in the log forever. If you're reading raw events you'll still see compacted ones. Use `selectMessages` to get the projection the model sees.
- **Provider streaming hangs.** Check the provider's `stream()` for unawaited promises. Use `AbortController` defensively.
- **Plugin not loading.** Check `package.json#moxxy.plugin.entry` resolves. Check `pnpm install` ran after creating the new package.
