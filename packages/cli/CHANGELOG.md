# @moxxy/cli

## 0.7.1

### Patch Changes

- 2e4bc37: Stability hardening for the web surface and process recovery (audit A7/A8): port-conflict recovery (web channel EADDRINUSE + runner protocol-mismatch) now verifies the holder is a moxxy process before signalling it and otherwise falls back to an ephemeral port instead of killing whatever listens (e.g. ngrok's UI on 4040); inbound web-surface WS frames are zod-validated and dropped (rate-limited warn) instead of crashing the process; the CLI installs last-resort unhandledRejection/uncaughtException guards.
- f3c798f: Stop CLI probe/light-boot sessions from leaking daemons. A new `probeSession`
  helper boots throwaway sessions with `skipInitHooks` (no scheduler poller, no
  webhooks listener — those now start exactly once, in the real session that
  owns them) and `disableSessionPersistence`, and guarantees the probe is closed
  before returning. Previously `moxxy <channel>` self-host booted three sessions
  and the orphaned probe won the webhooks port bind, so incoming webhooks ran
  turns on an abandoned session and duplicate scheduler pollers raced on the
  schedule store. Converted: the TUI needs-init probe, the `moxxy <command>`
  channel-existence probe, the channel-dispatch light-boots (`moxxy <channel>` /
  `moxxy channels …`), `moxxy schedule` store ops, the schedule-setup telegram
  check, and `moxxy plugins list`.
- 2e4bc37: Security (audit A4): webhook fires now actually enforce the trigger's `allowedTools`.
  The CLI webhook runner runs each fire against a per-fire scoped view of the active
  session — a filtered tool registry (the model only sees the listed tools) plus a
  wrapping permission resolver whose `check` and prompt-free `policyCheck` deny any tool
  outside the list (so the restriction survives goal-mode auto-approve), delegating
  allowed calls to the session's normal resolver chain. An empty `allowedTools` keeps the
  existing full-tool-set contract; the `webhook_create` description and setup guide now
  state exactly what is enforced and that fires run on the active session, not an
  isolated one.
- f297da0: Guard `afterWorkflow` triggers against cycles. Mutual triggers (A↔B, or longer loops) used to re-fire each other forever, burning provider tokens. Each run now carries its trigger chain on the `workflow_completed` event: re-fires that would revisit a workflow already in the chain, or exceed a depth cap of 8, are refused with a clear warning. On top of that, trigger sync statically detects cycles in the `afterWorkflow` graph, warns once naming the cycle, and disables auto-refire for its members (they remain runnable manually or on schedule).
- Updated dependencies [0326fb0]
- Updated dependencies [2e4bc37]
- Updated dependencies [f3c798f]
- Updated dependencies [0326fb0]
  - @moxxy/sdk@0.8.0

## 0.7.0

### Minor Changes

- 85f9b91: Share the desktop client layer across platforms and expose the IPC over a WebSocket.

  The desktop renderer's hooks, state stores, chat model, and IPC client are now
  transport- and platform-agnostic so a future mobile app can reuse them:

  - **`@moxxy/client-core`** — the `use*` hooks + chat/connection/ask stores + chat
    model + the transport singleton + a platform-capability registry. DOM-free; the
    desktop renderer consumes it via thin `@/lib/*` shims (no behavior change).
  - **`@moxxy/client-platform-web`** — the Web implementations of those capabilities
    (mic capture/PCM16, Web Speech TTS, localStorage, window event bus).
  - **`@moxxy/design-tokens`** — framework-neutral tokens + a `:root` CSS generator.
  - **`@moxxy/client-transport-ws`** — a `MoxxyApi` over the global `WebSocket`
    (no Node deps), for remote clients.
  - **`@moxxy/ipc-server-ws`** — serves the same `IpcCommands`/`IpcEvents` contract
    over an authenticated WebSocket (loopback by default, bearer-token gated). The
    desktop's IPC handler registration is now transport-neutral (a `CommandBus`/
    `EventSink` seam + a shared `dispatch` core in `@moxxy/desktop-ipc-contract`), so the
    same handler bodies serve Electron IPC and the WebSocket; events fan out to both.
  - **`@moxxy/plugin-channel-mobile`** — a `mobile` channel that serves the bridge from
    the CLI backed by the runner's single session: `moxxy mobile` (and `moxxy serve --all`)
    expose it with no desktop needed. It can reach beyond the LAN via a cloudflared/ngrok
    tunnel (`channels.mobile.tunnel`) and prints a **QR code** (URL + token embedded) to
    pair. The desktop bridge stays opt-in via `MOXXY_WS_BRIDGE`.
  - **`@moxxy/sdk`** — adds `resolveChannelToken` + `bearerGuard`: the standard channel
    auth-token resolution (env → `channels.<name>.token` → a persisted secret) and a
    pre-connection bearer handler, so channels gate connections uniformly. The mobile
    bridge + WS server adopt them.

  A new `apps/mobile` Expo proof-of-concept drives the chat loop (and permission prompts)
  through the shared hooks over the WebSocket bridge — against either backend. First launch
  shows a QR scanner that pairs by scanning `moxxy mobile`'s code. Desktop behavior is
  unchanged.

### Patch Changes

- Updated dependencies [85f9b91]
  - @moxxy/sdk@0.7.0

## 0.6.0

### Minor Changes

- fab0fb4: Update flows: a real `moxxy update`, a TUI "new version" nudge, and observable desktop self-update.

  - **CLI** — new `moxxy update` command: checks the npm registry, detects how the
    CLI was installed (npm/pnpm/yarn/bun, global or local), and runs the matching
    upgrade after a confirm. `--check`/`--dry-run` report-only, `--yes` to skip the
    prompt. Source checkouts get git advice instead of an install.
  - **TUI** — surfaces a newer published `@moxxy/cli` as a one-line, auto-dismissing
    banner and shows the running version in the status line. The check is cached
    (~12h) and fully non-blocking on startup. (Also fixes the `version` prop being
    dropped before it reached the view.)
  - **Desktop self-update** — the previously-silent fall-back-to-the-floor is now
    observable: a persistent boot-decision log under `<userData>/app/boot-log.json`,
    a reason for every gate that rejects a staged bundle, and a Settings → Dashboard
    → Diagnostics readout. The renderer's boot confirmation is hardened (retry +
    reported failure) so a flaky heartbeat can't make the boot-probe revert a
    healthy update. Adds the `app.updateDiagnostics` / `app.bootHeartbeatFailed` IPC.

## 0.5.5

### Patch Changes

- Updated dependencies [eac83e5]
  - @moxxy/sdk@0.6.0

## 0.5.4

### Patch Changes

- 9a789fe: Harden `moxxy plugins install`/`remove` against argument injection: the imperative
  install/uninstall path now rejects a flag-like spec (a leading `-`, e.g. `-g` or
  `--registry=…`) before handing it to `npm`, while still accepting the legitimate
  `name@version`, git (`github:`/`git+`/`https://`), and local-path specs. Internal
  cleanup: the duplicated `NPM_NAME_RE` / `diffSnapshot` / `PluginSnapshot` are hoisted
  into one shared module in `@moxxy/plugin-plugins-admin`.

## 0.5.3

### Patch Changes

- a2d551f: Desktop: resume a workspace's conversation + model context across app
  restarts, and make `/new` actually start a fresh session.

  The desktop owns and kills its `moxxy serve` child on quit, and each launch
  spawned a bare `serve` that minted a brand-new empty session — so the model
  forgot the whole conversation and the transcript collapsed to just the
  post-restart message (the TUI didn't have this because its long-lived daemon
  survives a window close). Now each per-workspace runner is given a sticky
  session id (its desk id) so it resumes `~/.moxxy/sessions/<id>.jsonl` if present
  and starts fresh under that id on first run.

  - New `SetupOptions.sessionId` / `BuildSessionArgs.sessionId`: "resume-if-present"
    (distinct from `resumeSessionId`, which errors when the log is missing — for
    an explicit `moxxy resume <id>`).
  - `serve` reads `MOXXY_SESSION_ID`; the desktop `RunnerSupervisor`/`RunnerPool`
    pass the workspace's desk id through to it.
  - Renderer: the runner replays its FULL history on every attach (and re-attach
    after a reconnect), so the chat runtime now de-dupes ingested events by id
    (`seenIds`, kept in lockstep across live append, replay, and pagination). This
    makes a resumed replay idempotent and also fixes a latent bug where a transient
    reconnect to a still-alive runner could duplicate the transcript.
  - `/new` now works on its own (previously it did nothing in the desktop — only
    `/clear` was handled). It clears the transcript AND resets the runner via a
    new `session.newSession` IPC → `RunnerSupervisor.resetSession()`, which wipes
    the persisted session log and restarts so the model context truly resets and
    doesn't resurrect on the next launch.

## 0.5.2

### Patch Changes

- b928391: Fix auto-compaction and auto-elision silently disabling on unrecognised model
  ids — the agent could grow its context unbounded and lose earlier context.

  `runCompactionIfNeeded` and `runElisionIfNeeded` resolved the model's context
  window via an exact `provider.models.find(m => m.id === ctx.model)` and bailed
  to a permanent no-op when it missed. But `config.model` is a free-form string
  and providers serve ids that aren't in their fixed descriptor list (a newer
  release like `claude-opus-4-8`, a dated id, or a runtime provider-admin model),
  so any such id turned BOTH context-management features off for the whole
  session. A shared `resolveModelContext` now falls back to the provider's first
  descriptor — exactly what the TUI context meter already did — so compaction and
  elision stay active on unlisted ids. The reactive overflow recovery
  (`runCompactionIfNeeded(ctx, { force: true })`) also now runs even when no
  window can be resolved at all, so an over-context turn compacts-and-retries
  instead of dying.

- Updated dependencies [b928391]
  - @moxxy/sdk@0.5.1

## 0.5.1

### Patch Changes

- fad9d6b: Make `moxxy login claude-code` resilient to Anthropic's transient OAuth 500s.

  Anthropic's OAuth endpoints (`claude.ai/oauth/authorize` and the
  `console.anthropic.com/v1/oauth/token` exchange) intermittently return an
  `Internal server error` on the first hit — the identical request then succeeds
  on retry. The token-exchange 500 previously aborted the whole sign-in, forcing
  a full browser re-auth. `postClaudeToken` now retries transient failures
  (5xx / 429 / network errors) up to 3 attempts with a short backoff, while
  deterministic 4xx (bad/expired/already-used code, `invalid_grant`) still surface
  immediately. On exhaustion the error carries an actionable "wait and re-run"
  hint instead of a raw API dump. The browser sign-in instructions also note that
  the authorize page may need a "Try again" click on the first attempt.

## 0.5.0

### Minor Changes

- ad26425: Add a `claude-code` provider so Claude Pro/Max subscribers can use moxxy with
  their subscription instead of a pay-as-you-go API key.

  - New `@moxxy/plugin-provider-claude-code`: talks to the standard Anthropic
    Messages API with a Claude Code OAuth bearer token (`anthropic-beta:
oauth-2025-04-20` + the required "You are Claude Code…" system preamble).
  - Two ways to authenticate: paste a token from `claude setup-token` (or set
    `CLAUDE_CODE_OAUTH_TOKEN`), or run `moxxy login claude-code` for an
    interactive out-of-band OAuth sign-in. Access tokens refresh automatically.
  - `@moxxy/plugin-provider-anthropic`: `AnthropicProvider` gained an OAuth mode
    (bearer auth + system preamble + refresh-on-401); the API-key path is
    unchanged.
  - `@moxxy/sdk`: `ProviderAuthContext` gained an optional `prompt()` so auth
    flows can ask the user to paste a code/token (used by the out-of-band flow).

### Patch Changes

- e64aa0e: Fix "Mode not registered: tool-use" after the mode rename. A mode name persisted
  anywhere (config `mode:`, `~/.moxxy/preferences.json`, a desktop workspace's
  stored mode, a runner `setMode` RPC, a mid-turn mode hand-off) is now funneled
  through a legacy-name map in `ModeRegistry.setActive`: it tries the literal name
  first and falls back to the current name (`tool-use`→`default`,
  `deep-research`→`research`; the removed `plan-execute`/`bmad`/`developer` →
  `default`). A validly-registered name is never overridden, and a genuinely
  unknown mode still throws. Exposes `migrateModeName(name)` from `@moxxy/sdk`.
- 2615cbf: Polish the TUI: simplify the `/plugins` picker and make slash autocomplete
  scrollable.

  - `/plugins` now uses a few basic tabs — **Providers, Modes, Channels, Tools,
    Others, Installable** — instead of one tab per contribution kind. Disabled
    plugins live under "Others" with an `[off]` badge. Heading is just "Plugins".
  - Modal headers no longer paint a filled background band (it rendered as dark
    "bars" on many terminals) — the title + tabs sit as clean text, with the
    active tab marked by an inverse pill.
  - The `/` slash-command dropdown is no longer capped at 8 entries: it shows a
    scrolling window over the full command set (with `↑ N more` / `↓ N more`),
    so every command is reachable with ↑↓.

- Updated dependencies [ad26425]
- Updated dependencies [e64aa0e]
  - @moxxy/sdk@0.5.0

## 0.4.0

### Minor Changes

- b014c3a: Slim the loop modes to three and turn plugin management into a first-class,
  plug/unplug system.

  Modes: the registry now ships only `default` (the Claude Code-style ReAct loop,
  package renamed `@moxxy/mode-tool-use` → `@moxxy/mode-default`, export
  `toolUseModePlugin` → `defaultModePlugin`), `goal` (autonomous auto-approve
  loop), and `research` (mode-name renamed from `deep-research`). The `bmad`,
  `developer`, and `plan-execute` modes are removed. Persisted preferences with
  the old mode names (`tool-use`, `deep-research`) are migrated on read, so
  existing sessions keep working.

  Plugins: the standalone "marketplace" is gone — install/remove/enable/disable
  and the installable-plugin catalog now live in `@moxxy/plugin-plugins-admin`.
  The `moxxy plugins` CLI gains `search`, `install`, `remove`, `enable`,
  `disable`, and `open` subcommands (alongside `list`/`reload`/`new`), and the TUI
  gains a `/plugins` picker (tabbed by plugin kind) to plug/unplug plugins live.
  The model can manage plugins on request via new `search_plugins` (npm registry +
  catalog discovery), `enable_plugin`, and `disable_plugin` tools, plus the
  existing `install_plugin` / `uninstall_plugin` — so "find me a plugin for X and
  install it" / "disable plugin X" work in natural language. Disabling a plugin now
  persists to `~/.moxxy/config.yaml` AND is honored by `pluginHost.reload()`, so a
  disabled plugin is never silently resurrected.

  SDK: `PluginHostHandle.list()` entries carry an optional `kinds` array; new
  `PluginsAdminView` / `InstallablePluginView` / `LoadedPluginView` session
  capabilities back the `/plugins` picker; `SessionOptions` gains an
  `isPluginDisabled` predicate.

### Patch Changes

- Updated dependencies [b014c3a]
  - @moxxy/sdk@0.4.0

## 0.3.3

### Patch Changes

- d362a6b: Support sending documents (PDFs, Office/text) to the model. Adds a `document`
  `ContentBlock`, a `supportsDocuments` flag on `ModelDescriptor`, and a
  `'document'` `UserPromptAttachment` kind; `projectMessages` routes document
  attachments to the native block. The Anthropic, OpenAI, and Codex providers
  translate documents to their native shapes (Anthropic `document`, OpenAI
  `file`, Responses `input_file`), so attached files now reach the model for
  analysis instead of being dropped.
- Updated dependencies [d362a6b]
  - @moxxy/sdk@0.3.0

## 0.3.2

### Patch Changes

- 6dea644: Fix tool calls getting stuck "running" forever (flipping to error only on the next message). When the stuck-loop detector tripped, `mode-tool-use` (the default mode) and `mode-goal` ended the turn after emitting `tool_call_requested` but before running the call — orphaning it with no `tool_result`. The turn still completed (re-enabling the composer), so the orphaned call spun indefinitely until the next `user_prompt` swept it into an error. Both modes now synthesize a failed result for every already-emitted request before bailing, matching the abort path and the already-correct plan-execute/developer modes. This also stops the provider from rejecting the unresolved tool-use block on the following turn.

## 0.3.1

### Patch Changes

- f3e3f1e: Fix tool calls getting stuck "running" forever (flipping to error only on the next message). When the stuck-loop detector tripped, `mode-tool-use` (the default mode) and `mode-goal` ended the turn after emitting `tool_call_requested` but before running the call — orphaning it with no `tool_result`. The turn still completed (re-enabling the composer), so the orphaned call spun indefinitely until the next `user_prompt` swept it into an error. Both modes now synthesize a failed result for every already-emitted request before bailing, matching the abort path and the already-correct plan-execute/developer modes. This also stops the provider from rejecting the unresolved tool-use block on the following turn.

## 0.3.0

### Minor Changes

- 0afd61d: Make an active mode visually obvious while it's running.

  Modes can now advertise a presentation `badge` (`ModeDef.badge`), surfaced on
  `SessionInfo.activeModeBadge` so every channel sees it over the wire. Goal mode
  declares one, so activating it now shows a persistent indicator the user can't
  miss — even mid-loop, when the usual mode footer is replaced by the "Thinking"
  marker:

  - **TUI** — a reverse-video `GOAL` pill stays pinned to the status line for the
    whole run, alongside the busy spinner.
  - **Desktop** — a persistent accent banner above the composer plus an accented
    Mode chip, both lit/cleared the moment the mode switches.

### Patch Changes

- Updated dependencies [0afd61d]
  - @moxxy/sdk@0.2.0

## 0.2.0

### Minor Changes

- df0593b: Add a `Sleep` built-in tool and a new `goal` mode (`/goal <objective>`).

  - **`Sleep` tool** — lets the agent pause for a set duration (`seconds` and/or `ms`, capped at
    5 minutes, abort-aware) to wait on an external/async process before re-checking, instead of
    busy-looping.
  - **`goal` mode + `/goal`** — `/goal <objective>` switches into the new `goal` mode,
    auto-approves every tool call (yolo) for the run, and starts working immediately. Unlike
    tool-use, the loop does NOT end when the model stops emitting tools — it keeps re-prompting
    the model to continue until the model explicitly calls the `goal_complete` tool (success,
    with a summary + evidence) or `goal_abandon` (blocked, needs the user). Every run is bounded
    by an iteration cap, a cumulative token budget, a stuck-loop detector, and no-progress
    detection, and stops immediately on user interrupt (Esc/Ctrl-C). Available in every channel
    via `/mode goal`.

### Patch Changes

- f469c0f: `moxxy init`: provider selection is now a single-choice picker instead of a multi-select.

  Users reported the old multi-select step was unintuitive — it wasn't obvious you had to toggle items on/off, and a required multi-select with nothing checked reads as a dead end. The wizard now uses a single `select` (one provider, pre-highlighted, just press Enter), which also removes the now-redundant "which provider should be primary?" step and renumbers the remaining steps (model → 3, mode → 4, embedder → 5, plugin-security → 6, review → 7). The generated `moxxy.config.yaml` is unchanged in shape, and you can still add more providers afterward via config `fallbacks` or the provider-admin tools. This matches the desktop app's onboarding, which already used a single-provider picker.

## 0.1.6

### Patch Changes

- bf8ef82: `moxxy login`: add a `--browser` flag that forces the loopback/browser OAuth flow even when stdin isn't a TTY.

  Previously a GUI host (the desktop app) that spawned `moxxy login <provider>` with piped stdio got the headless device-code flow — the user had to open a URL and type a code by hand. With `--browser`, the CLI runs the loopback flow that opens the system browser automatically and catches the localhost callback, so no copying is needed. (`--no-browser` still forces device-code.)

## 0.1.5

### Patch Changes

- f846b56: `moxxy serve` now boots even when no provider key is configured.

  Previously `serve` activated a provider at startup and exited 1 with `AUTH_NO_CREDENTIALS` when none was found — _before_ binding its socket. Clients (notably the desktop app) then looped forever on "lost the runner / reconnecting" and could never connect to add a provider. `serve` now boots with `tolerateNoProvider` (matching `channels` / `login`): it binds the socket with no active provider, and turns fail with a clear "no provider" error until one is configured.

## 0.1.4

### Patch Changes

- f07d698: Remove the two `npm install` deprecation warnings (`prebuild-install`, `boolean`) and slim the default install.

  `@moxxy/cli` no longer installs heavy native optional dependencies by default:

  - **keytar → `@napi-rs/keyring`**: keytar pulls the deprecated `prebuild-install`; `@napi-rs/keyring` ships per-platform NAPI prebuilds with no install scripts. OS-keychain unlock for the vault is preserved (it still falls back to the disk key / passphrase when the native binary is unavailable).
  - **`@huggingface/transformers` and `playwright` are now install-on-demand** (dropped from `optionalDependencies`). Both were already loaded via guarded dynamic `import()`; the local-embeddings and browser features degrade gracefully and prompt to install when first used. This is what pulled `boolean` (via `onnxruntime-node` → `global-agent`).

  Net effect: `npx @moxxy/cli` installs only `@moxxy/sdk`, `zod`, and `@napi-rs/keyring` — no deprecation warnings, smaller and faster.

- e73b51e: `moxxy init`: collect the vault passphrase as a styled first step instead of a bare prompt.

  On a first run the vault needs a passphrase to derive its encryption key. Previously this fired as an unstyled `readline` prompt _before_ the wizard (and before the logo). It's now a `@clack/prompts` `password` step — rendered under the moxxy logo, with a short description — so it reads as the first pre-requirement step of setup, consistent with the rest of the wizard. Threaded via a new `SetupOptions.passphrasePrompt`; headless `init` is unaffected (still uses `MOXXY_VAULT_PASSPHRASE` / the non-TTY guard).

## 0.1.3

### Patch Changes

- 93d9a2d: Publish with `pnpm publish` instead of `npm publish` so pnpm's `workspace:*` and `catalog:` protocols are rewritten to concrete version ranges in the published `package.json`.

  The previous `npm publish` shipped those protocols verbatim, so `npx @moxxy/cli init` failed on a clean machine with:

  ```
  npm error code EUNSUPPORTEDPROTOCOL
  npm error Unsupported URL Type "workspace:": workspace:*
  ```

  Both `@moxxy/cli` (`dependencies."@moxxy/sdk": "workspace:*"`, `zod: "catalog:"`) and `@moxxy/sdk` (`peerDependencies.zod: "catalog:"`) were affected, so both are republished.

- Updated dependencies [93d9a2d]
  - @moxxy/sdk@0.1.3

## 0.1.0

### Minor Changes

- c4352f9: First published release of the `moxxy` CLI and SDK (off the `0.0.0` placeholder).

### Patch Changes

- Updated dependencies [c4352f9]
  - @moxxy/sdk@0.1.0
