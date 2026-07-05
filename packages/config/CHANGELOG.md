# @moxxy/config

## 0.28.1

### Patch Changes

- Updated dependencies [6c0af71]
  - @moxxy/sdk@0.28.1

## 0.28.0

### Patch Changes

- Updated dependencies [3e4b2b4]
- Updated dependencies [e4e2941]
  - @moxxy/sdk@0.28.0

## 0.27.0

### Minor Changes

- e5ea7e6: The LAST config store outside the unified tree is gone: runtime-registered
  (OpenAI-compatible) vendors now persist at `plugins.provider.items.<name>`
  in `~/.moxxy/config.yaml` (`config` carries the vendor payload, `model` the
  default) instead of `~/.moxxy/providers.json`. The provider-admin API is
  unchanged — the tools, the runner's `provider.configure`, and the desktop
  settings sheet all moved with it; the desktop reads the tree directly (yaml
  parse, no @moxxy/config in the Electron main). `provider_remove` refuses to
  touch a built-in provider's item (picker-written model/enabled prefs
  survive). Clean-slate per repo convention: re-add custom vendors via
  `provider_add` or the desktop sheet — no migration shim.
- 2cef8e1: feat(reflector): swappable `reflector` registry category + `@moxxy/reflector-default` learning loop.

  A new single-active registry category — the learning-loop block that watches a finished turn and _proposes_ memory/skill improvements without ever writing silently. Mirrors the `eventStore` category across all 7 layers (config `plugins.reflector.default`, SDK `ReflectorDef`/`ReflectContext`/`ReflectionProposal` contract + plugin slot, core `ReflectorRegistry`, host registry-kind wiring, session field + `services('reflectors')`, CLI apply/category-swap, catalog), but NULLABLE: core seeds no floor, so reflection is opt-in (like transcriber/synthesizer).

  `@moxxy/reflector-default` (discovery-loaded) ships the default `ReflectorDef` `'default'` AND the driver in one plugin. The driver's `onTurnEnd` runs a cheap gate (≥5 tool results OR ≥1 error OR ≥8 mode iterations) under a one-reflection-per-session budget, then fires the reflection FIRE-AND-FORGET so it never blocks or throws into the turn. The reflector does one cheap side-channel LLM pass over a turn digest and returns 0-2 proposals; those are delivered as a ONE-TIME nudge on the next `onBeforeProviderCall`, phrased so the model MAY call `memory_save` / `synthesize_skill` — which still hit their own permission prompts. No silent writes. Graceful no-provider / provider-error skips; `memory_save` and `synthesize_skill` are declared as optional requirements. User-model injection of proposals is deferred to a follow-up PR.

- ee2967d: `/settings` (alias `/config`): a curated in-TUI config panel — reasoning,
  prompt caching, elision, lazy tools, loop guard, plugin security, TUI theme
  and footer hints toggle/cycle in place, persist to the user config through
  the ONE schema-validated comment-preserving writer (new `setConfigValue`,
  which the `config_set` tool now also delegates to), and live-apply via the
  new optional `SessionLike.configAdmin` seam (RemoteSession degrades to
  "applies on restart"). New `tui:` config section (`theme: default|mono`,
  `hints`, `keys` Ctrl-letter overrides for force-send/drop-queued/
  expand-tools) projected onto the TUI's env conventions at launch.
- 502acf0: Slim wave, final batches: the whisper STT pair, the Telegram + Slack
  channels, provider-admin and mcp move out of the CLI binary — all seeded
  into the desktop (voice, Settings panels and Apps→Channels keep working
  offline) and installable on demand everywhere else. `moxxy telegram` /
  `moxxy channels start slack` on a slim install print the exact install
  command instead of "unknown command". `@moxxy/config` flips public as the
  channels' dependency closure. The kernel is now the plan's target set: the
  TUI, built-in tools, default mode, context floors, vault, plugins-admin,
  commands, memory, the two OAuth providers, and the dormant daemons.

### Patch Changes

- 87aac6d: Declare honest `isolation` capability specs on the remaining admin and long-tail plugin tools (36 tools across 13 packages), completing the backfill that lets `security.requireDeclaration` be enabled.
- 49b1d73: Install-time capability consent + third-party requireDeclaration ratchet.
  Installing a plugin now surfaces the package's combined capability surface
  (fs globs, net mode/hosts, env, exec commands, time/memory budgets) in
  human-readable rows shared across every surface. Third-party packages
  (outside the `@moxxy/` scope) require explicit consent to stay enabled:
  the TUI opens a fail-closed post-install picker (ESC = decline = disabled),
  `moxxy plugins install` asks a default-NO confirm on a TTY and headless runs
  need `--yes` (otherwise the package is left installed but disabled), and the
  permission-gated `install_plugin` model tool keeps returning the report
  non-interactively. Undeclared tools are called out loudly — their surface is
  unknown, not empty. New `security.thirdPartyRequireDeclaration: off|warn|enforce`
  ('warn' by default while security is enabled) logs a once-per-tool structured
  warning — or denies with 'enforce' — when a third-party tool has no isolation
  declaration; unattributed tools (e.g. runtime-attached MCP tools) are exempt.
  `moxxy security status` prints the new mode.
- Updated dependencies [e791484]
- Updated dependencies [49b1d73]
- Updated dependencies [3b27404]
- Updated dependencies [0b6f40e]
- Updated dependencies [2cff46b]
- Updated dependencies [2cef8e1]
- Updated dependencies [98f545c]
- Updated dependencies [ee2967d]
- Updated dependencies [2a35357]
- Updated dependencies [67a3387]
- Updated dependencies [be28d55]
  - @moxxy/sdk@0.27.0

## 0.26.0

### Patch Changes

- Updated dependencies [8c70f3c]
- Updated dependencies [8c70f3c]
- Updated dependencies [ce56ef6]
  - @moxxy/sdk@0.26.0

## 0.25.0

### Patch Changes

- @moxxy/sdk@0.25.0

## 0.24.1

### Patch Changes

- @moxxy/sdk@0.24.1

## 0.24.0

### Patch Changes

- Updated dependencies [f71c8bd]
  - @moxxy/sdk@0.24.0

## 0.23.0

### Patch Changes

- Updated dependencies [aec6e0e]
  - @moxxy/sdk@0.23.0

## 0.22.0

### Patch Changes

- Updated dependencies [48542df]
- Updated dependencies [f980349]
- Updated dependencies [1dc1697]
- Updated dependencies [069cd0e]
  - @moxxy/sdk@0.22.0

## 0.21.1

### Patch Changes

- @moxxy/sdk@0.21.1

## 0.21.0

### Minor Changes

- 074f845: Make the stuck-loop guard more tolerant + configurable. The detector was tripping turns too eagerly — its exact-repeat threshold was 3 (the same tool+input 3× in a window of 8), which legitimately-repeated work (re-reading a file, re-running `git status` across steps) could hit. Raised the defaults to exact=8 / near=10 / window=12, since `maxIterations` (500 in default mode) is the real runaway backstop and the guard only needs to catch a _tight_ same-call loop.

  It's now tunable via `context.loopGuard` in config: `enabled` (set `false` to disable the guard entirely and rely on `maxIterations`), `windowSize`, `repeatThreshold`, `nearWindowSize`, `nearThreshold`. Threaded through the session → ModeContext → every loop strategy (default, goal, collaborative + subagents), and live-reloadable.

### Patch Changes

- Updated dependencies [074f845]
- Updated dependencies [3a4b604]
  - @moxxy/sdk@0.21.0

## 0.2.0

### Minor Changes

- 2ccd62e: EventStore registry — make the session event-log storage backend swappable (Pillar 2).

  The JSONL persistence behind a session's event log is now a registry kind (`eventStore`) like any other swappable block, behind a new `EventStoreDef` contract (`open(scope)` for the write path; `restore`/`readPage` for resume + history paging). Core seeds the built-in JSONL store (`~/.moxxy/sessions/<id>.jsonl` + meta sidecar) as the **protected floor** — a thin adapter over the existing `SessionPersistence`, so behaviour is byte-identical.

  A plugin can contribute an alternative store (SQLite, remote, encrypted, in-memory). Because the kind uses throw-on-duplicate `register` (not override) and the floor auto-adopts first, a discovered store is registered but never silently activates — the user opts in by name via `plugins.eventStore.default`. Since the store sees every event (prompts, tool I/O), that explicit opt-in is the trust boundary. The floor can be swapped but never removed, and a boot assertion guarantees a session always has an active store.

  `SessionMeta`/`SessionSource`/`EventPage` moved to `@moxxy/sdk` (the contract's data shapes) and are re-exported from `@moxxy/core` — no importer churn.

- 9bff8a1: Make the stuck-loop guard more tolerant + configurable. The detector was tripping turns too eagerly — its exact-repeat threshold was 3 (the same tool+input 3× in a window of 8), which legitimately-repeated work (re-reading a file, re-running `git status` across steps) could hit. Raised the defaults to exact=8 / near=10 / window=12, since `maxIterations` (500 in default mode) is the real runaway backstop and the guard only needs to catch a _tight_ same-call loop.

  It's now tunable via `context.loopGuard` in config: `enabled` (set `false` to disable the guard entirely and rely on `maxIterations`), `windowSize`, `repeatThreshold`, `nearWindowSize`, `nearThreshold`. Threaded through the session → ModeContext → every loop strategy (default, goal, collaborative + subagents), and live-reloadable.

- 2ccd62e: Unified `plugins:` manifest + critical floor (Pillar 1).

  Replace the three overlapping config stores (the flat `provider`/`mode`/`compactor`/`workflowExecutor` keys, the package-keyed `plugins:` map, and `~/.moxxy/preferences.json`) with a single category-grouped `plugins:` tree in `~/.moxxy/config.yaml`:

  - **`plugins.packages.<pkg>`** — the install/enable ledger (one entry per npm package).
  - **`plugins.<category>.{default, items}`** — the swap axis, one slot per registry kind, keyed by contribution name (e.g. `plugins.provider.default: anthropic`).

  A **critical floor** makes the platform unbreakable: core default modules can be _swapped_ to another registered implementation but never _disabled_ — a missing/typo'd default reverts to a protected built-in floor, kernel packages refuse to be disabled (`PLUGIN_PROTECTED`), and a boot assertion guarantees every non-nullable slot is filled.

  New swap surfaces: the `set_default`/`list_defaults` model tools, `moxxy plugins set-default`/`defaults`, the TUI `/plugins` **Defaults** tab, and a `PluginsAdminView.categories()`/`setCategoryDefault()` view contract.

  `preferences.json` is retired: the persisted provider/mode/model/disabled-set now live in the same tree, written through `@moxxy/config` (`setCategoryDefault`/`setProviderModel`/`setProviderEnabled`). **Breaking (pre-1.0, no back-compat):** existing `~/.moxxy/config.yaml` files using the old keys must be rewritten; `moxxy init`'s output and `config_init`'s template emit the new shape.

### Patch Changes

- Updated dependencies [2ccd62e]
- Updated dependencies [9bff8a1]
- Updated dependencies [bddaa83]
- Updated dependencies [5c1c334]
- Updated dependencies [2ccd62e]
  - @moxxy/sdk@0.20.0

## 0.1.15

### Patch Changes

- Updated dependencies [08f927a]
  - @moxxy/sdk@0.19.0

## 0.1.14

### Patch Changes

- Updated dependencies [e4fe785]
  - @moxxy/sdk@0.18.0

## 0.1.13

### Patch Changes

- Updated dependencies [0d6df6e]
  - @moxxy/sdk@0.17.0

## 0.1.12

### Patch Changes

- Updated dependencies [648c966]
  - @moxxy/sdk@0.16.1

## 0.1.11

### Patch Changes

- Updated dependencies [b19d401]
  - @moxxy/sdk@0.16.0

## 0.1.10

### Patch Changes

- Updated dependencies [92fecb8]
  - @moxxy/sdk@0.15.2

## 0.1.9

### Patch Changes

- Updated dependencies [e762d40]
  - @moxxy/sdk@0.15.1

## 0.1.8

### Patch Changes

- Updated dependencies [cbf115b]
  - @moxxy/sdk@0.15.0

## 0.1.7

### Patch Changes

- Updated dependencies [50a5b38]
- Updated dependencies [50a5b38]
- Updated dependencies [50a5b38]
  - @moxxy/sdk@0.14.5

## 0.1.6

### Patch Changes

- Updated dependencies [897a1fc]
  - @moxxy/sdk@0.14.4

## 0.1.5

### Patch Changes

- Updated dependencies [5f20dab]
  - @moxxy/sdk@0.14.3

## 0.1.4

### Patch Changes

- Updated dependencies [091ef41]
  - @moxxy/sdk@0.14.2

## 0.1.3

### Patch Changes

- Updated dependencies [640d036]
  - @moxxy/sdk@0.14.1

## 0.1.2

### Patch Changes

- Updated dependencies [e1fb6a6]
- Updated dependencies [e1fb6a6]
  - @moxxy/sdk@0.14.0

## 0.1.1

### Patch Changes

- Updated dependencies [89ad994]
  - @moxxy/sdk@0.13.0

## 0.1.0

### Minor Changes

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

### Patch Changes

- Updated dependencies [33e9640]
- Updated dependencies [143264a]
- Updated dependencies [7366a09]
- Updated dependencies [951f374]
  - @moxxy/sdk@0.12.0

## 0.0.14

### Patch Changes

- Updated dependencies [aacdf1d]
  - @moxxy/sdk@0.11.0

## 0.0.13

### Patch Changes

- Updated dependencies [2796066]
  - @moxxy/sdk@0.10.0

## 0.0.12

### Patch Changes

- Updated dependencies [1e4ed09]
- Updated dependencies [4a8ec5d]
- Updated dependencies [6afc4c0]
  - @moxxy/sdk@0.9.0

## 0.0.11

### Patch Changes

- Updated dependencies [cf2f651]
- Updated dependencies [cf2f651]
- Updated dependencies [cf2f651]
- Updated dependencies [cf2f651]
  - @moxxy/sdk@0.8.1

## 0.0.10

### Patch Changes

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
