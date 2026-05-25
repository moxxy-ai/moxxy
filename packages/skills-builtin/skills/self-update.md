---
name: self-update
description: Extend or repair moxxy's OWN capabilities — add a tool/skill the user asks for, or fix a recurring failure — by authoring a plugin or skill through a guardrailed, verified, auto-rollback transaction.
triggers:
  - "add a tool"
  - "add a capability"
  - "teach yourself"
  - "update yourself"
  - "extend yourself"
  - "give yourself"
  - "self-update"
  - "self update"
  - "modify your code"
  - "change your code"
  - "you should be able to"
  - "can you learn to"
---

# Self-update — author or repair a capability, safely

Use this when the user asks you to **add a capability** ("add a tool that…",
"you should be able to…") or to **fix a recurring failure** in your own
behavior, and the change requires editing code/skills rather than just doing
the task. Every code write goes through a `prompt` permission gate and every
change is verified before it counts — there is no silent self-modification.

Pick the **lowest-risk tier** that satisfies the request:

| Tier | When | Mechanism | Reversible by |
|------|------|-----------|---------------|
| **A — Skill** | A recurring *procedure* expressible with tools that already exist ("always run X before Y") | a `.md` skill in `~/.moxxy/skills` (no code) | delete one file |
| **B — Plugin** | A new *action* (call an API, run a script) or a *behavior override* of an existing tool | a plugin in `~/.moxxy/plugins`, hot-reloaded | unload + restore |
| **C — Core** | Genuinely needs to edit `@moxxy/core` (new event type, registry, the loop itself) | provision source → build + test → overlay → restart | snapshot restore + restart |

Prefer A, then B. **Most "core fixes" should still be a plugin *override*** (wrap
a tool, swap a mode) — that's hot-reloadable and reversible. Only use Tier C
when the change genuinely cannot be expressed as a plugin. Tier C is heavy
(provisions a source clone, builds, then needs a process restart) and every
step is approval-gated.

## Loop

1. **Classify.** Call `self_update_classify` with the request text (or
   `trigger: "error"` after a failure). It reads recent errors + the live tool
   set and recommends a tier. The recommendation is *advisory* — apply the
   table above. If a published plugin already does it, prefer `install_plugin`
   over authoring from scratch.

2. **State the smallest change** in one sentence. A new plugin should add the
   one tool/hook needed — no "while I'm here" extras.

3. **Open a transaction.** `self_update_begin({ kind, name })` snapshots the
   target so it can be rolled back. For a brand-new plugin, scaffold first with
   `moxxy plugins new <name>` (zero-build `.mjs` that hot-reloads), or write a
   `src/index.ts` (loaded via jiti).

4. **Surface the change BEFORE writing.** Tell the user the diagnosis/goal and
   the exact file contents you're about to write. Then write with `Write` /
   `Edit` — the user approves each at the permission prompt. Never bundle edits
   into a `bash` heredoc to dodge the prompts.

5. **Verify.** `self_update_verify({ txnId })` builds (if the plugin has a
   build script), runs its tests, hot-reloads it into the session, and confirms
   it registered. If it fails on a *modified* plugin, the previous working
   version is auto-restored. Read the returned `stages` to see what broke.

6. **Apply or roll back.** If verify passes, show the user what registered and
   call `self_update_apply({ txnId })` to keep it. If runtime behavior is wrong,
   `self_update_rollback({ txnId })`.

7. **Stop after 2 failed verify cycles.** `self_update_verify` refuses a 3rd
   attempt, rolls back to a clean state, and returns `escalate: true`. When that
   happens, stop editing and report to the user: the original goal, what you
   tried, and the captured errors. Don't loop.

## Tier C — core patch (heavy, restart-required)

Only when a plugin override genuinely can't do it. Confirm with the user first.

1. `self_update_core_preflight` — checks git/pnpm + that the install has pinned
   source provenance (`gitHead` + repo url). If any check fails, STOP and tell
   the user (e.g. set `options.repoUrl` in config, or update via npm instead).
2. `self_update_core_begin({ packages })` — provisions a source clone at the
   exact installed commit (slow). Returns a `coreTxnId` + repo path.
3. Edit with `self_update_core_write` / `self_update_core_edit` (paths relative
   to the repo). Show the diff first.
4. `self_update_core_verify({ coreTxnId })` — builds/typechecks/tests the
   affected packages + dependents, and rejects any change that adds a new
   runtime dependency.
5. `self_update_core_apply({ coreTxnId })` — overlays the build into the live
   install (snapshotting the old dist) and stages a restart. **Tell the user a
   restart is required.** It auto-commits on the next clean boot.
6. If a patch is bad, `self_update_core_rollback({ coreTxnId })` (or
   `moxxy self-update rollback <coreTxnId>` from a shell) + restart.

## Expressing a fix as a plugin override (Tier B templates)

A plugin can change core behavior without touching core, via lifecycle hooks:

- **Wrap a misbehaving tool's output** — `onToolResult(ctx)`: if
  `ctx.result.toolName === 'X'`, return a repaired/truncated result.
- **Block or rewrite a bad call** — `onToolCall(ctx)`: return
  `{ action: 'deny', reason }` or `{ action: 'rewrite', input }`.
- **Add a capability** — a new `defineTool({...})` in the plugin's `tools`.
- **Augment the system prompt** — `onBeforeProviderCall(req)`: return
  `{ ...req, system: req.system + extra }`.
- **Swap the loop/compaction strategy** — register a mode/compactor and
  activate it from the plugin's `onInit`.

Minimal plugin entry (`~/.moxxy/plugins/<name>/index.mjs`):
```js
import { definePlugin, defineTool, z } from '@moxxy/sdk';

export default definePlugin({
  name: 'my-capability',
  version: '0.0.0',
  tools: [
    defineTool({
      name: 'my_tool',
      description: 'One sentence, lead with a verb.',
      inputSchema: z.object({ arg: z.string() }),
      permission: { action: 'prompt' },
      handler: async ({ arg }) => ({ result: arg }),
    }),
  ],
});
```

## Don't

- **Don't skip the transaction.** Always `self_update_begin` before editing so
  there's a snapshot to roll back to.
- **Don't edit `@moxxy/core` or other framework packages here.** That's Tier C —
  escalate. Reach for a plugin override first.
- **Don't keep retrying a failing change.** Two failed verifies is the wall.
- **Don't self-update silently.** This responds to an explicit request or a
  reported failure — not proactive tinkering.
