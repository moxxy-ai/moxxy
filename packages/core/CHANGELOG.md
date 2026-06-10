# @moxxy/core

## 0.0.13

### Patch Changes

- Updated dependencies [2796066]
  - @moxxy/sdk@0.10.0

## 0.0.12

### Patch Changes

- 4a8ec5d: Workflows round-2 correctness: gate the unshippable `awaitInput` resume, make the visual builder work on the desktop, and fix loop/validation correctness.

  **`awaitInput` is gated (was a hang-forever dead-end).** The executor can pause + checkpoint an `awaitInput` step, but the resume trigger/channel that delivers the operator's reply never shipped to `main` — `resumeWorkflowRun` had zero production callers. So an agent-drafted "ask me, then act" workflow would pause forever, leak a retained child session for the process lifetime, and orphan a checkpoint file. `awaitInput` is now **rejected at validate/save time** with a clear "requires the resume channel, not available in this build" message, and `draft.ts` no longer teaches it (it steers the author to `inputs` fields instead). Defense-in-depth: the CLI runner treats a `paused` result as non-terminal (no inbox delivery), `Session.close()` clears retained child sessions so they can't leak, and a `WorkflowRunStore.sweepStale()` sweeper (7-day TTL, run on workflows boot) reaps orphaned `~/.moxxy/workflow-runs/active/` checkpoints. The executor pause/resume path is kept intact so re-enabling is a matter of landing a resume trigger and removing the schema gate.

  **Visual builder works on the desktop now.** The desktop drives a `RemoteSession`, whose workflows view only forwarded `list`/`setEnabled`/`run` — so the builder's `validateDraft`/`save`/`getRun` were `undefined` and threw "not supported on this session". Added a `workflow.validateDraft|save|getRun` runner-RPC family (**protocol bumped to v4**) with RemoteSession client methods + server handlers, so the desktop builder validates/saves/loads against the runner.

  **Loop + validation correctness.** A condition/switch step used as a loop body is rejected (its branch routing was silently ignored). A non-loop-body step that `needs` a loop-body step is rejected (it would stall — body steps are excluded from the main DAG). A loop-body step's own `when` guard and any `needs` other than its loop step / a sibling body step are rejected (body steps run unconditionally each iteration). Logic-step `vars` now drop `__proto__`/`constructor`/`prototype` keys (prototype-pollution guard). Paused-run checkpoints persist + restore `vars` set before the pause. Renaming a workflow via the builder removes the old file/entry instead of leaving an orphaned duplicate (`save(workflow, previousName)`, threaded through the view → IPC → runner RPC → builder hook).

- Updated dependencies [1e4ed09]
- Updated dependencies [4a8ec5d]
- Updated dependencies [6afc4c0]
  - @moxxy/sdk@0.9.0

## 0.0.11

### Patch Changes

- cf2f651: Audit wave: documentation drift + dead-code cleanup.

  - Removed dead exports: `@moxxy/core`'s unused `selectPendingToolCalls` / `selectCurrentTurn`
    event selectors and `@moxxy/sdk`'s unused voice helpers (`checkTranscriberReady`,
    `resolveTranscriber`, `pickFirstAvailableTranscriber`) — zero importers across the repo.
  - `@moxxy/plugin-telegram` no longer declares `zod` as a dependency (it never imported it).
  - CLI `--help` ENV section now lists the user-facing `MOXXY_*` variables and points at the
    new full table in the README.
  - Docs-only (no release impact): AGENTS.md/README.md architecture lists reconciled against
    the actual package set (mode-default replaces the deleted mode-tool-use; PR #120 client
    layer + channel-web/view/mobile + apps/mobile added), the published `@moxxy/sdk` README
    examples rewritten against the real API, apps/docs corrections (tools-builtin reality,
    testing API, four providers, full package index), and the dead `lint` task removed from
    turbo.json.

- cf2f651: Security: four audit leftovers (A43–A46). MCP server credentials now support `${vault:NAME}` placeholders in env/header values, resolved only at connect time (the persisted mcp.json and the model-visible tool args keep the placeholder; `mcp_add_server`/`mcp_test_server` instruct vault-first). Agent-view URLs are scheme-allow-listed (`https`/`http`/`mailto`/`tel` + relative; `data:image/*` for img src only) at BOTH walls: a canonical `isSafeViewUrl` in the sdk enforced by `parseView` and `validateDoc`, and a render-time re-check in the web frontend that neutralizes `javascript:`/`data:text` hrefs and srcs. `web_fetch` closes its DNS-rebinding TOCTOU by pinning every hop's connection to the SSRF-guard-vetted addresses via an undici dispatcher with a fixed lookup (SNI/cert validation intact). Telegram inline-keyboard callbacks now enforce the same pairing authorization gate as text/voice messages.
- Updated dependencies [cf2f651]
- Updated dependencies [cf2f651]
- Updated dependencies [cf2f651]
- Updated dependencies [cf2f651]
  - @moxxy/sdk@0.8.1

## 0.0.10

### Patch Changes

- 0326fb0: Event-log and session-persistence hardening (audit wave 5):

  - `EventLog.ingest` no longer leaks async listener rejections as unhandled rejections — they are swallowed under the same non-fatal policy as `append()`.
  - Session event-log write failures are no longer silent: one structured warning per failure streak (path + error), a `SessionPersistence.degraded` flag, and a recovery log once writes succeed again.
  - `restoreEvents` re-sequences restored events to contiguous seq 0..n-1 around corrupt JSONL lines (warning with skip/re-sequence counts) and atomically repairs the on-disk file, so a single corrupt middle line no longer truncates attached-client replay or causes seq collisions on new appends.
  - `projectMessages` skips empty/whitespace-only assistant text blocks (keeping tool_use blocks), so tool-only turns — including historical wedged logs — no longer produce empty text blocks that providers reject.

- 2e4bc37: Goal-mode auto-approve now respects user permission policy (audit A3). `PermissionResolver` gains an optional prompt-free `policyCheck(call, ctx)` (implemented by core's policy wrapper) that returns the engine/tool-rule decision without ever falling through to an interactive prompt. Goal mode consults it before auto-allowing, so `~/.moxxy/permissions.json` deny rules now deny in unattended runs — previously the auto-approve resolver replaced the whole policy chain, silently ignoring them.
- f3c798f: `/new` now truly resets the session everywhere (audit A10). New `session.reset` runner RPC (protocol v3) + optional `SessionLike.reset()` capability: the runner aborts in-flight turns and clears its authoritative event log; the log's new `EventLog.onClear` listeners broadcast a `session.reset` notification so every attached mirror clears in lockstep (re-arming seq-0 ingest instead of silently rejecting all further events) and truncate the persisted session JSONL so wiped history can't resurrect on `--resume` — fixing the same resurrection bug for local `/new`. The TUI and Telegram `/new` paths call `reset()` (falling back to `log.clear()` when the capability is absent) and report an error instead of claiming "history cleared" when the reset RPC fails.
- Updated dependencies [0326fb0]
- Updated dependencies [2e4bc37]
- Updated dependencies [f3c798f]
- Updated dependencies [0326fb0]
  - @moxxy/sdk@0.8.0

## 0.0.9

### Patch Changes

- Updated dependencies [85f9b91]
  - @moxxy/sdk@0.7.0

## 0.0.8

### Patch Changes

- Updated dependencies [eac83e5]
  - @moxxy/sdk@0.6.0

## 0.0.7

### Patch Changes

- Updated dependencies [b928391]
  - @moxxy/sdk@0.5.1

## 0.0.6

### Patch Changes

- Updated dependencies [ad26425]
- Updated dependencies [e64aa0e]
  - @moxxy/sdk@0.5.0

## 0.0.5

### Patch Changes

- Updated dependencies [b014c3a]
  - @moxxy/sdk@0.4.0

## 0.0.4

### Patch Changes

- Updated dependencies [d362a6b]
  - @moxxy/sdk@0.3.0

## 0.0.3

### Patch Changes

- Updated dependencies [0afd61d]
  - @moxxy/sdk@0.2.0

## 0.0.2

### Patch Changes

- Updated dependencies [93d9a2d]
  - @moxxy/sdk@0.1.3

## 0.0.1

### Patch Changes

- Updated dependencies [c4352f9]
  - @moxxy/sdk@0.1.0
