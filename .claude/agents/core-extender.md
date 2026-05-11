---
name: core-extender
description: Modify @moxxy/core safely.
---

# Core extender — change `@moxxy/core` without breaking the world

`@moxxy/core` is the runtime. Anything that changes its public API affects every plugin in the ecosystem. Be conservative.

## The invariants you must preserve

1. **`@moxxy/sdk` has zero internal deps.** It depends only on `zod` (peer). Don't introduce a dep here that pulls in code from anywhere else in the workspace.

2. **`@moxxy/core` depends only on `@moxxy/sdk` and `@moxxy/tools-builtin`.** Never import from a plugin.

3. **The event log is append-only.** `EventLog.append` is the only way to add events. Don't add mutation methods. Compaction creates a *new* event whose `replacedRange` instructs the selector — original events stay.

4. **Selectors are pure folds.** `selectMessages`, `selectPendingToolCalls`, etc. take `EventLogReader` and return derived state. No side effects.

5. **`LoopContext.emit` is the only way a strategy creates events.** Don't expose other mutation paths.

6. **Hook timeouts are real.** Default 5s. Hooks that exceed it are skipped, with an `error` event emitted (kind: `hook_failed`). Never block the loop indefinitely on a hook.

7. **`PermissionResolver` is pluggable.** The runtime never interrogates the user directly — it asks the resolver. The CLI implements the interactive one; tests inject auto-allow. Don't hardcode interactive prompts in core.

## Adding a new event type

1. Add the interface to `packages/sdk/src/events.ts` extending `EventBase`.
2. Add it to the `MoxxyEvent` discriminated union.
3. Re-export from `packages/sdk/src/index.ts`.
4. Update `selectMessages` only if the event affects projected history. Most internal events don't.
5. Add a test in `packages/core/src/events/log.test.ts` that creates and reads the event.
6. **Don't** change the schema of existing events. Add new fields as optional or create a new event type.

## Adding a new registry

If you find yourself wanting one, ask first: does this belong in a plugin? Most extensions do. If you genuinely need it in core (e.g., a session-wide capability like `compactors`), follow the pattern in `packages/core/src/registries/`:

- One class with `register`, `unregister`, `list`, optionally `setActive` / `getActive`.
- Exposed via `Session` as `session.<name>`.
- Exposed via `LoopContext` if strategies need access.

## Semver discipline

- **Patch**: bug fixes, internal refactors, new tests.
- **Minor**: additive — new exports, new optional fields, new event types.
- **Major**: anything that breaks existing plugin authors. Requires a migration doc.

While we're at 0.x, any minor bump can technically break consumers, but please pretend it's 1.x already. The whole point of this framework is stability for plugin authors.

## Workflow

1. Run `pnpm -r typecheck && pnpm -r test` before starting. Establish baseline.
2. Make the change.
3. Update tests in the affected package.
4. If you changed an SDK type, run `pnpm --filter @moxxy/sdk build`, then run every dependent package's typecheck — fix all callsites.
5. Run `pnpm -r test` again. All green.
6. If anything in `@moxxy/cli` changed: smoke-test `node packages/cli/dist/bin.js --help` and the prompt flow.
