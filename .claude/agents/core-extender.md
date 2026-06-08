---
name: core-extender
description: Modify @moxxy/core safely.
---

# Core extender — change `@moxxy/core` without breaking the world

`@moxxy/core` is the runtime. Anything that changes its public API affects every plugin in the ecosystem. Be conservative.

## The invariants you must preserve

1. **`@moxxy/sdk` has zero internal deps.** It depends only on `zod` (peer). Don't introduce a dep here that pulls in code from anywhere else in the workspace. dep-cruise enforces this.

2. **`@moxxy/core` never imports a plugin.** Static imports from core into `@moxxy/plugin-*`, `@moxxy/mode-*`, `@moxxy/compactor-*`, or `@moxxy/skills-builtin` are forbidden by dep-cruise. Plugins are dynamically loaded — pulling them in statically inverts the dependency arrow.

3. **The event log is append-only.** `EventLog.append` is the only way to add events. Don't add mutation methods. Compaction creates a *new* event whose `replacedRange` instructs the selector — original events stay.

4. **Selectors are pure folds.** `selectMessages`, `selectPendingToolCalls`, `selectCurrentTurn` take `EventLogReader` and return derived state. No side effects.

5. **`LoopContext.emit` is the only way a strategy creates events.** Don't expose other mutation paths.

6. **Hook timeouts are real.** Default 5s. Hooks that exceed it are skipped, with an `error` event emitted. The timer is `clearTimeout`'d on the fast path; orphan rejections are swallowed. Don't regress that.

7. **`PermissionResolver` is pluggable.** The runtime never interrogates the user directly — it asks the resolver. The CLI implements the interactive one; tests inject auto-allow; channels use `createDeferredPermissionResolver`. Don't hardcode interactive prompts in core.

8. **Concurrency safety.** EventLog listeners are snapshotted before fan-out (so subscribe/unsubscribe mid-dispatch doesn't perturb iteration). `runTurn` filters subscribers by `turnId` so two concurrent turns on the same Session don't cross-contaminate. Stores that read-modify-write whole files (vault, permissions) serialize through a promise-chain mutex AND persist via tmp+rename. Don't drop these guarantees when refactoring.

9. **Wire every lifecycle hook end-to-end.** `dispatchEvent` and `dispatchShutdown` were dead code (declared, never invoked) until they got wired through `EventLog.subscribe` and `Session.close()` respectively. If you add a new lifecycle hook, dispatch it from somewhere observable.

## Adding a new event type

1. Add the interface to `packages/sdk/src/events.ts` extending `EventBase`.
2. Add it to the `MoxxyEvent` discriminated union.
3. Re-export from `packages/sdk/src/index.ts`.
4. Update `selectMessages` only if the event affects projected history. Most internal events don't.
5. Add a test in `packages/core/src/events/log.test.ts` that round-trips the event.
6. **Don't** change the schema of existing events. Add new fields as optional or create a new event type.

## Adding a new registry

If you find yourself wanting one, ask first: does this belong in a plugin? Most extensions do. If you genuinely need it in core (e.g., a session-wide capability like `compactors`), follow the pattern in `packages/core/src/registries/`:

- One class with `register`, `unregister`, `list`, optionally `setActive` / `getActive`.
- Exposed via `Session` as `session.<name>`.
- Exposed via `LoopContext` if strategies need access.
- **Atomic swaps when needed.** If callers might rebuild the registry from scratch (like `reload_skills`), expose a `replaceAll(items)` that does the swap synchronously. Never `clear()` then `await` then `register()` — the gap is observable.

## Adding a new lifecycle hook

1. Declare it in `packages/sdk/src/hooks.ts` (`LifecycleHooks` interface).
2. Add a `dispatch<Name>` method to `HookDispatcherImpl` in `packages/core/src/plugins/lifecycle.ts`.
3. **Invoke it from somewhere.** A declared-but-never-dispatched hook is silently dead. Subscribe from `EventLog`, call from `Session`, or thread through `LoopContext` so loop strategies fire it.
4. Add a test that registers a plugin with the hook and verifies it runs.

## Semver discipline

- **Patch**: bug fixes, internal refactors, new tests.
- **Minor**: additive — new exports, new optional fields, new event types.
- **Major**: anything that breaks existing plugin authors. Requires a migration doc.

While we're at 0.x, any minor bump can technically break consumers, but please pretend it's 1.x already. The whole point of this framework is stability for plugin authors.

## Workflow

1. Run `pnpm -r typecheck && pnpm -r test && pnpm check:deps` before starting. Establish baseline.
2. Make the change.
3. Update tests in the affected package.
4. If you changed an SDK type, run `pnpm --filter @moxxy/sdk build`, then run every dependent package's typecheck — fix all callsites.
5. Run `pnpm -r test && pnpm check:deps` again. All green.
6. If anything in `@moxxy/cli` changed: smoke-test `node packages/cli/dist/bin.js --help` and `moxxy doctor`.

## Don't

- **Don't expand `LoopContext` casually.** Every field is something every loop strategy must understand. Add via a sub-object (e.g., `ctx.experimental.X`) if the value's audience is narrow.
- **Don't break replay determinism.** Anything in the event projection that depends on wall-clock time, env, or randomness is a replay bug.
- **Don't `--no-verify` git commits or skip dep-cruise.** Fix the underlying issue.
- **Don't reach into private fields of `Session` with `as unknown as {x}` casts.** Add a real method. We had `setPermissionResolver()` for exactly this reason.
