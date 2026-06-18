# @moxxy/core

## 0.2.2

### Patch Changes

- Updated dependencies [89ad994]
  - @moxxy/sdk@0.13.0

## 0.2.1

### Patch Changes

- 951f374: Make the model's reasoning visible, and redesign sub-agents as a collapsible group.

  **Reasoning preview (per-provider, Codex-style between calls).** When enabled, the model's
  thinking now streams live (replacing the silent "thinking…" dots) and is kept as a dim,
  collapsible "Thinking" block interleaved with the tool calls it precedes — so you can see what
  the model is doing instead of waiting out a multi-second pause. Because reasoning is finalized
  once per provider round, summaries land naturally between tool batches.

  It's gated per provider/model via a new `ModelDescriptor.supportsReasoning` capability and turned
  on with `config.context.reasoning` (`true`, or `{ effort: 'low' | 'medium' | 'high' }`):

  - **Anthropic / Claude Code** — adaptive thinking with summarized display; the signed thinking
    block round-trips so interleaved-thinking tool-use continuations stay valid.
  - **OpenAI Codex** — surfaces the reasoning summary it already requests (previously discarded).
  - **OpenAI** — `reasoning_effort` for the gpt-5 family plus the `reasoning_content` summary that
    OpenAI-compatible reasoning backends stream.

  New SDK surface: a `reasoning` `ContentBlock`, `reasoning_delta`/`reasoning_signature`
  `ProviderEvent`s, `reasoning_chunk`/`reasoning_message` events, a `ProviderRequest.reasoning`
  knob, and `ModelDescriptor.supportsReasoning`. No runner protocol bump — reasoning events ride
  the existing event channel.

  **Grouped sub-agents view.** A `dispatch_agent` fan-out now renders as one collapsible group —
  a header (`N Explore agents finished`) over a tree of per-agent rows showing each agent's tool-use
  count, **token usage**, and status — instead of one block per child. Per-agent token totals and the
  agent kind are forwarded on the `subagent_*` events; both the desktop and TUI render the new tree.

- Updated dependencies [33e9640]
- Updated dependencies [143264a]
- Updated dependencies [7366a09]
- Updated dependencies [951f374]
  - @moxxy/sdk@0.12.0

## 0.2.0

### Minor Changes

- aacdf1d: Desktop: live registry refresh + interactive provider management.

  The runner now broadcasts `info.changed` after every completed turn, so registry changes made by tools inside a conversation (provider_add, mcp_add, workflow_create, skill writes, …) reach attached clients; the desktop forwards the push to the renderer (`session.info.changed` → `SESSION_INFO_REFRESH_EVENT`) and the Settings panel re-fetches live — no more app restart to see an agent-added provider.

  Settings → Providers is now interactive: enable/disable any provider (runner protocol v7 `provider.setEnabled`, persisted to `preferences.json#disabledProviders` and honored by boot's activation walk; disabling the ACTIVE provider is refused), and a Configure sheet sets the API key (vault + live readiness re-probe via `provider.refreshReady`) and, for runtime-registered providers, the stored baseURL/default model (`provider.configure` through the new `SessionLike.providerAdmin` view). OAuth providers get a `moxxy login` hint instead of a key form.

### Patch Changes

- Updated dependencies [aacdf1d]
  - @moxxy/sdk@0.11.0

## 0.1.0

### Minor Changes

- 4c594d8: Wave of desktop/mobile fixes. Runner protocol v6 (additive): clients can supply the turn id (`runTurn.turnId`) so renderer per-turn filters actually match — fixing the silently-broken "generate skill with AI" flow and hidden-turn leaks — and `attach` gains a replay policy (`'full' | 'none' | { tail }`) with EventLog rebase so the desktop no longer replays full session history on app start/desk switch (history comes from the paginated NDJSON log). Desktop settings gain a shared "ask moxxy to do it" background-agent modal: the skill generator is refactored onto it and MCP servers and Providers get Add buttons driving `mcp_add_server`/`provider_add`, with permission asks surfaced in-modal (plus a global ask fallback outside the chat view). Subagents now inherit the parent's resolved model: hallucinated model ids warn and fall back, workflow-trigger spawns use the session's last resolved model, and hardcoded model-id fallbacks are gone. Clerk sign-in returns to the app instead of stranding on the hosted My-account page (explicit fallback redirect URLs + a main-process account-portal recovery handler). Workflow canvas: Delete/Backspace removes the selected node and dropping a connector on empty canvas opens an insert-node menu. Mobile: reconnects re-prime the connection store (fixes the deaf "Connected" state after a runner restart), gateway URL commits on blur, the redundant header actions toggle is gone, menu entries are chips, executed tools open a diagnostics panel on tap, and the QR scanner starts scanning immediately.

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
