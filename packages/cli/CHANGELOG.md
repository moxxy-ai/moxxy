# @moxxy/cli

## 0.21.0

### Minor Changes

- 05df794: `/plugins` now distinguishes **built-in** (bundled) from **installed** (on-demand from `~/.moxxy/plugins`) packages instead of showing everything as "on": the plugin host reports `installed` (manifest present = discovered) and the Packages tab badges core / installed / built-in. The Installable catalog is also populated with the six unbundled API-key providers (anthropic, openai, google, xai, zai, local) so they can be installed from the picker (and the init optional-plugins step).
- e7b6853: Add the headless provisioner foundation for Pillar 3 (slim-core / on-demand setup): a shared `provision()` engine + a `moxxy provision` command + a first-party provider catalog.

  `provision({ provider, model, key, basics })` resolves the provider from the catalog, installs its package (skipping it when it's already registered — i.e. bundled — so it never duplicate-registers), installs accepted basics, stores the key in the vault, and writes the unified `plugins:` config — config last, so a mid-flight failure leaves no half-state. `moxxy provision` drives it headlessly via flags (`--provider anthropic --key … --model …`) or a JSON spec on stdin (`--spec -`) — the same engine the interactive `init` wizard + the desktop first-run will use.

  Safe + additive: providers stay bundled, `init` is unchanged. Includes `pinFirstPartySpec` (pins first-party installs to the CLI version, scoped to provision so it can't break the generic `install_plugin` path) and the `PROVIDER_CATALOG` (slug → package + auth + default model). Rewiring `init` + the actual unbundling/publishing are the gated follow-ups.

- 5c943a3: Slim the bundle + rework init around on-demand providers. The six API-key providers (anthropic, openai, google, xai, zai, local) are no longer bundled into the CLI — they install on demand from npm into `~/.moxxy/plugins` and are discovered by the plugin host, keeping the kernel slim (no eager provider onInit / tool bloat at boot). The two OAuth/subscription providers (openai-codex, claude-code) stay bundled as the out-of-box "sign in" default (and the CLI's credential resolver links their token helpers).

  `init` is reworked: it offers the full provider catalog (loaded + installable), and an `ensureProvider` step installs + enables a not-yet-bundled provider before collecting its key/OAuth. A new optional wizard step lets you install extra plugins. The shared `provision()` engine + `moxxy provision` (flags or `--spec -`) drive the same install→vault→config flow headlessly.

  Also: the six private provider packages are flipped publishable + added to a fixed changeset group (co-version with cli/sdk/core), and a latent bug is fixed — plugin discovery now honors `MOXXY_HOME` (matching where installs land), so an installed provider is reliably discovered + activated.

### Patch Changes

- 074f845: Make the stuck-loop guard more tolerant + configurable. The detector was tripping turns too eagerly — its exact-repeat threshold was 3 (the same tool+input 3× in a window of 8), which legitimately-repeated work (re-reading a file, re-running `git status` across steps) could hit. Raised the defaults to exact=8 / near=10 / window=12, since `maxIterations` (500 in default mode) is the real runaway backstop and the guard only needs to catch a _tight_ same-call loop.

  It's now tunable via `context.loopGuard` in config: `enabled` (set `false` to disable the guard entirely and rely on `maxIterations`), `windowSize`, `repeatThreshold`, `nearWindowSize`, `nearThreshold`. Threaded through the session → ModeContext → every loop strategy (default, goal, collaborative + subagents), and live-reloadable.

- 3a4b604: Add a generic "special mode" mechanism. `ModeDef.special` (a `ModeSpecial` descriptor, optionally `{ invokedBy }`) marks a mode that is entered only via its own invocation — never offered in a mode list and never name-switched from `/mode`. Special modes are filtered uniformly via the new `isSelectableMode` predicate across every surface: `SessionInfo.modes` (mobile/desktop), the TUI `/mode` picker + by-name switch (which now points the user at `/<invokedBy>`), and the `/plugins` swap axis. The collaborative modes (`collaborative`, `collab-architect`, `collab-peer`) opt in — they're a separate system launched by `/collab` (TUI) or the desktop CollaboratePanel, not a pickable mode. Extensible: future special modes set the same flag.
- d924a73: TUI: multi-session switcher (`/sessions`).

  - New `/sessions` slash command (alias `/switch`) opens a `ListPicker` overlay
    listing your saved conversations — first-prompt title, last-active time, event
    count and active model — sourced from the same `~/.moxxy/sessions` index the
    desktop sidebar and `moxxy resume` already read. The session you're in is
    marked, and a leading **+ New session** entry starts a fresh conversation.
  - Picking an entry re-points the TUI onto that session in place: the live session
    is torn down (firing its `onShutdown` hooks and releasing the runner socket),
    the chosen session is booted (resuming its persisted history, or a fresh one),
    and the chat view re-mounts onto it. Your previous conversation stays saved, so
    you can switch back and forth.
  - Works when the TUI hosts the session (the default self-host / `--standalone`
    modes). When attached to an external `moxxy serve` (whose runner owns a single
    fixed session) the switcher degrades to a notice pointing at `moxxy resume`.

- Updated dependencies [074f845]
- Updated dependencies [3a4b604]
  - @moxxy/sdk@0.21.0

## 0.16.0

### Minor Changes

- 2ccd62e: EventStore registry — make the session event-log storage backend swappable (Pillar 2).

  The JSONL persistence behind a session's event log is now a registry kind (`eventStore`) like any other swappable block, behind a new `EventStoreDef` contract (`open(scope)` for the write path; `restore`/`readPage` for resume + history paging). Core seeds the built-in JSONL store (`~/.moxxy/sessions/<id>.jsonl` + meta sidecar) as the **protected floor** — a thin adapter over the existing `SessionPersistence`, so behaviour is byte-identical.

  A plugin can contribute an alternative store (SQLite, remote, encrypted, in-memory). Because the kind uses throw-on-duplicate `register` (not override) and the floor auto-adopts first, a discovered store is registered but never silently activates — the user opts in by name via `plugins.eventStore.default`. Since the store sees every event (prompts, tool I/O), that explicit opt-in is the trust boundary. The floor can be swapped but never removed, and a boot assertion guarantees a session always has an active store.

  `SessionMeta`/`SessionSource`/`EventPage` moved to `@moxxy/sdk` (the contract's data shapes) and are re-exported from `@moxxy/core` — no importer churn.

- 2ccd62e: Unified `plugins:` manifest + critical floor (Pillar 1).

  Replace the three overlapping config stores (the flat `provider`/`mode`/`compactor`/`workflowExecutor` keys, the package-keyed `plugins:` map, and `~/.moxxy/preferences.json`) with a single category-grouped `plugins:` tree in `~/.moxxy/config.yaml`:

  - **`plugins.packages.<pkg>`** — the install/enable ledger (one entry per npm package).
  - **`plugins.<category>.{default, items}`** — the swap axis, one slot per registry kind, keyed by contribution name (e.g. `plugins.provider.default: anthropic`).

  A **critical floor** makes the platform unbreakable: core default modules can be _swapped_ to another registered implementation but never _disabled_ — a missing/typo'd default reverts to a protected built-in floor, kernel packages refuse to be disabled (`PLUGIN_PROTECTED`), and a boot assertion guarantees every non-nullable slot is filled.

  New swap surfaces: the `set_default`/`list_defaults` model tools, `moxxy plugins set-default`/`defaults`, the TUI `/plugins` **Defaults** tab, and a `PluginsAdminView.categories()`/`setCategoryDefault()` view contract.

  `preferences.json` is retired: the persisted provider/mode/model/disabled-set now live in the same tree, written through `@moxxy/config` (`setCategoryDefault`/`setProviderModel`/`setProviderEnabled`). **Breaking (pre-1.0, no back-compat):** existing `~/.moxxy/config.yaml` files using the old keys must be rewritten; `moxxy init`'s output and `config_init`'s template emit the new shape.

### Patch Changes

- 9bff8a1: Make the stuck-loop guard more tolerant + configurable. The detector was tripping turns too eagerly — its exact-repeat threshold was 3 (the same tool+input 3× in a window of 8), which legitimately-repeated work (re-reading a file, re-running `git status` across steps) could hit. Raised the defaults to exact=8 / near=10 / window=12, since `maxIterations` (500 in default mode) is the real runaway backstop and the guard only needs to catch a _tight_ same-call loop.

  It's now tunable via `context.loopGuard` in config: `enabled` (set `false` to disable the guard entirely and rely on `maxIterations`), `windowSize`, `repeatThreshold`, `nearWindowSize`, `nearThreshold`. Threaded through the session → ModeContext → every loop strategy (default, goal, collaborative + subagents), and live-reloadable.

- 497e9a1: Make `@moxxy/plugin-mcp` discovery-loadable — the second "stash a session capability" plugin. `Session.mcpAdmin` is now a getter over a published `'mcpAdmin'` service, core publishes its `'skills'` registry, and the vault plugin additionally publishes a `'resolveSecrets'` accessor (a `${vault:NAME}`-placeholder resolver) so mcp can resolve secrets without depending on `@moxxy/plugin-vault`. The plugin's default export (`mcpAdminPlugin`) resolves `'tools'` + `'skills'` + `'resolveSecrets'` from `ctx.services` in `onInit` (via lazy `Proxy`s), then publishes its runtime control api as `'mcpAdmin'` — replacing the host stash + `{ toolRegistry, skillRegistry, secretResolver }` closure. `userSkillsDir` defaults to `~/.moxxy/skills`. The runner's mcp handlers + the desktop read `session.mcpAdmin` exactly as before.
- 08e9eb2: Convert `@moxxy/memory-consolidate` to a discovery-loadable default export (`memoryConsolidatePlugin`). The memory plugin now publishes its long-term store on the inter-plugin service registry (`services.register('memory', store)`), and memory-consolidate resolves both that store and the active provider (via the published `'providers'` registry) from `ctx.services` in `onInit` — typed against a minimal inline interface so it needs no `@moxxy/core` import — instead of the `(store, getProvider)` closure. The `buildMemoryConsolidatePlugin` factory is kept for direct injection; `builtin-entries` uses the default export.
- bddaa83: Inter-plugin service registry (`AppContext.services`) — plugins publish a named service in `onInit` and consume siblings' services in theirs, requirements-ordered so the provider runs first. This decouples cross-plugin dependencies from the host's `build*({ deps })` constructor wiring, letting a plugin be discovery-loaded (default-exported) instead of hand-built by the orchestrator.

  The vault plugin now publishes its secret store (`services.register('vault', vault)`), and `@moxxy/plugin-oauth` is the first consumer to go discovery-loadable: the default-exported `oauthPlugin` resolves the vault from `ctx.services.require('vault')` in `onInit` (declaring `@moxxy/plugin-vault` as a requirement for ordering), so it no longer needs the `{ vault }` closure. `buildOauthPlugin` is kept for direct injection.

  Since plugin `onInit` already runs with full in-process privileges (the security isolation wraps tool execution, not plugin code), this doesn't widen the effective trust surface.

- e3491a9: Make `@moxxy/plugin-provider-admin` discovery-loadable — the first of the "stash a session capability" plugins. `Session.providerAdmin` is now a getter over a published `'providerAdmin'` service (RemoteSession keeps its own field for thin clients), and core publishes a stable `'resolveCredentials'` accessor. The plugin's default export (`providerAdminPlugin`) resolves the `'providers'` registry + `'resolveCredentials'` from `ctx.services` in `onInit` (via a lazy `Proxy` so its tools + stored-provider re-registration run unchanged) and publishes its admin api as `'providerAdmin'` — replacing the host stash + `{ providerRegistry, resolveActiveConfig }` closure. The runner + desktop read `session.providerAdmin` exactly as before.
- 5c1c334: The host now publishes its core registries on the inter-plugin service registry under well-known names (`agents`, `tools`, `providers`, `viewRenderers`, `synthesizers`), and the SDK exposes a minimal `NamedRegistry<T>` view (`get`/`list`/`has`) so a discovery-loaded plugin can resolve one in `onInit` without importing `@moxxy/core`'s concrete registry types.

  Two more closure-injected plugins go discovery-loadable on this seam: `@moxxy/plugin-subagents` (`subagentsPlugin` — resolves the `agents` + `tools` registries for `dispatch_agent`'s kind lookup + parent-tool snapshot) and `@moxxy/plugin-voice-admin` (`voiceAdminPlugin` — resolves the `synthesizers` registry for `list_voices`/`set_voice`). Both read the registries lazily at tool-call time and keep their `build*` factories for direct injection. `builtin-entries` uses the default exports.

- 238e434: Make the last two closure-injected plugins discovery-loadable, completing the onInit refactor wave (all 11 done).

  - **self-update** (`selfUpdatePlugin`): core publishes `'pluginHost'` (reload/unload/listSkipped), a live `'registrySnapshot'`, and a writable `'appendEvent'` (the counterpart to the read-only `ctx.log`); the host publishes a `'getPluginOptions'` config accessor. The plugin resolves them in `onInit`. The Tier-2 core-update tools are gated at build on `MOXXY_NO_CORE_UPDATE` (the env the desktop sets to hide them); `allowCoreUpdate`/`repoUrl` prefs resolve at run.
  - **web** (`webChannelPlugin`): core publishes `'tunnelProviders'`; the host publishes the shared `'webControls'` ref + `'webDefaultTunnel'`. The plugin resolves those + the existing `'viewSurface'` ref in `onInit` via a lazy `tunnels` object (keeping its tools + boot tunnel-apply hook present). web writes `viewSurface`; the view plugin reads it.

- 15299d8: Convert the telegram + Codex-OAuth Whisper transcriber plugins to discovery-loadable default exports (`telegramPlugin`, `whisperCodexPlugin`) that resolve the vault from the inter-plugin service registry in `onInit` instead of a `build*({ vault })` closure, declaring `@moxxy/plugin-vault` as a requirement for ordering. The `build*` factories are kept for direct injection. Same pattern as `@moxxy/plugin-oauth` — extending the onInit refactor wave across the channel + transcriber plugin kinds.
- d643573: Convert `@moxxy/plugin-view` to a discovery-loadable default export (`viewPlugin`). The host publishes the shared web-surface ref as the `'viewSurface'` service (the same mutable ref the web channel writes via `publishSurface`), and `viewPlugin` resolves `'viewRenderers'` (active renderer) + `'viewSurface'` from `ctx.services` in `onInit` — typed against minimal inline interfaces so it needs no `@moxxy/core` import — instead of the `{ getRenderer, getSurface }` closure. `present_view` reads both lazily at call time and degrades gracefully when absent. `buildViewPlugin` is kept for direct injection.
- Updated dependencies [2ccd62e]
- Updated dependencies [9bff8a1]
- Updated dependencies [bddaa83]
- Updated dependencies [5c1c334]
- Updated dependencies [2ccd62e]
  - @moxxy/sdk@0.20.0

## 0.15.1

### Patch Changes

- 08f927a: feat: pick which session ambient triggers run in + a compact trigger marker

  Ambient triggers (webhooks, schedules, workflows) used to fire on whichever
  session **created** them, and the synthesized prompt — often a large block
  carrying an untrusted webhook payload — rendered as a giant user bubble. Two
  changes:

  **Pick the target session.** Each trigger can now be pinned to a chosen session
  (where its run executes _and_ displays), decoupled from who created it:

  - `webhook_create` / `schedule_create` take an optional `targetSessionId`
    (defaulting to the creating session), and `webhook_update` /
    `schedule_set_target` reassign it. These map onto the existing
    `ownerSessionId` routing key, so the webhook queue/drain and the scheduler
    owner-gate already deliver to the right runner — no routing change.
  - Workflows gained a top-level `targetSessionId`. Scheduled workflows stamp it
    onto their scheduler mirror row (reusing the owner-gate); `fileChanged` is
    watched only by the target runner; a cross-session `afterWorkflow` dependent
    is skipped with a warning (the completion event is in-process to the parent's
    runner). The visual builder preserves the field across a round-trip.
  - Desktop: the Webhooks / Schedules / Workflows panels and the workflow builder
    gain a session picker (new `*.setTargetSession` IPC commands), and each
    summary surfaces the resolved target-session name.

  **Compact trigger marker.** A fired trigger now renders as a one-line,
  expandable chip ("Webhook received · github-issues", "Schedule fired · daily",
  "Workflow ran · digest") instead of the raw prompt — click to reveal the full
  payload. The prompt still lives in the model's context (security fences intact);
  only the display changes (new optional `origin` on the `user_prompt` event,
  threaded from the fired turn via `RunTurnOptions.origin`).

  Unset everywhere preserves today's behavior; single-process CLI/TUI is
  unaffected.

- Updated dependencies [08f927a]
  - @moxxy/sdk@0.19.0

## 0.15.0

### Minor Changes

- e4fe785: Make scheduled prompts and workflow triggers multi-tenant across concurrent runner processes.

  The desktop runs one `moxxy serve` per workspace, and every runner ran its own scheduler poller / workflow-trigger wiring over the SAME shared stores. A due schedule (and any workflow it fires) therefore ran once **per runner** — N times for N open workspaces — and skill/workflow-mirrored schedules had no notion of which runner should own them.

  Now:

  - Schedules carry an optional `ownerSessionId`. `schedule_create` stamps it with the creating runner's `MOXXY_SESSION_ID`, so a schedule created in a workspace's chat fires only on **that** runner (its result lands where it was asked for), not whichever poller happens to tick first.
  - Owner-less schedules (skill- and workflow-mirrored rows, or a single-process CLI with no session id) fire **exactly once across all runners** via a new cross-process "fire exactly once" lock (`CrossProcessFireLock`, exported from `@moxxy/sdk/server`) keyed on the entry's exact fire instant.
  - Workflow `fileChanged` triggers are likewise guarded by the cross-process lock in the multi-runner case, so one edit runs the workflow once instead of once per watching runner.

  Single-process CLI/TUI behavior is unchanged (no `MOXXY_SESSION_ID` → owner-less, fires as before).

- e62b6f5: Make webhook deliveries multi-tenant across concurrent runner processes, and auto-restore the proxy tunnel on boot.

  The webhook listener binds a single shared port, so with several runners (the desktop runs one `moxxy serve` per workspace) ONE runner received every delivery and fired it on **its own** session — a webhook created in workspace A's chat would fire in whatever workspace happened to win the port, or not reach A at all. And the proxy tunnel only ever lived in memory, so after a restart the saved public URL pointed at nothing (GitHub showed "We couldn't deliver this payload: timed out").

  Now:

  - Webhook triggers carry an optional `ownerSessionId`; `webhook_create` stamps it with the creating runner's `MOXXY_SESSION_ID`.
  - The runner that owns the listener routes each verified, filtered delivery: a trigger owned by **another** runner is handed off via a shared on-disk queue (`~/.moxxy/webhooks/queue/`); owner-less or own triggers fire in-process as before.
  - Every runner runs a drain poller that fires the queued deliveries addressed to **its** session — so the digest lands in the workspace that created the webhook. Deliveries for an offline workspace wait durably until it returns (with a 7-day stale sweep).
  - The runner that wins the listener bind **re-opens the proxy tunnel on boot** when the saved public URL came from the proxy, so "the app is running" once again means "the webhook URL is reachable." Only that one runner restores it, so the N runners don't collide on the single keypair-derived relay subdomain.

  Single-process CLI/TUI behavior is unchanged (no `MOXXY_SESSION_ID` → every delivery fires in-process, no queue/drain).

### Patch Changes

- Updated dependencies [e4fe785]
  - @moxxy/sdk@0.18.0

## 0.14.14

### Patch Changes

- Updated dependencies [0d6df6e]
  - @moxxy/sdk@0.17.0

## 0.14.13

### Patch Changes

- 3862cb2: Unify sessions into a single source of truth across TUI / desktop / mobile.

  A session now lives in exactly ONE place — its per-session file
  `~/.moxxy/sessions/<id>.json` (the conversation stays in the append-only
  `<id>.jsonl`). `~/.moxxy/desktop/desks.json` is reduced to a thin workspace
  overlay (desk definitions + active pointers); the per-desk session list is
  DERIVED from the session files at read time and grouped by an explicit `groupId`
  (falling back to cwd for CLI/TUI sessions). Deleting a session = erasing its file,
  so a removed session/workspace can never resurrect — which removes the whole class
  of "deleted workspace comes back after restart" bugs and deletes ~300 lines of
  copy/reconciliation code (`syncSessionIndexIntoRegistry`, `registerSessionFromMeta`,
  partial-resume detection, legacy name hydration, the `withSessionTitles` pass).

  - `@moxxy/core`: the session metadata file (`<id>.json`, versioned) gains
    `source` (originating channel), `groupId` (workspace membership) and `title`
    (user rename). New helpers: `listSessionMetas` (cheap, mtime-cached, single
    `readdir`), `seedSessionMeta`, `setSessionTitle`, `setSessionGroup`. The runner
    adopts a file's stable identity (`startedAt`/`source`) and PRESERVES the
    UI-owned `title`/`groupId` across its writes, so a live runner never clobbers a
    rename/move. `deleteSession` is the single deletion mechanism.
  - `@moxxy/workspace-registry`: derives the desk/session view from the session
    files with an mtime-parse cache; `moveSession` re-homes a session by `groupId`.
  - `@moxxy/desktop-host`: a sessions-dir watcher pushes a debounced (and
    projection-diffed) `desks.changed` so a title/first-prompt/new-session/deletion
    syncs live to desktop + mobile; the desk-removal flow tears runners down before
    erasing files.
  - No migration: pre-existing sessions may be dropped; old desk _definitions_ are
    read in place (their embedded session arrays are ignored).

## 0.14.12

### Patch Changes

- 648c966: Keep collaborative peers on the selected model and keep mobile overlays interactive while turns stream.
- 648c966: Prevent foreign session events from polluting shared workspace session lists and transcripts.
- 648c966: Keep the standalone mobile gateway pinned to its live session after registry hydration, so paired mobile clients stay connected and chat sends reach the active runner.
- 648c966: Start the full `apps/mobile` Expo app automatically when running `moxxy mobile`, wire it to the working WebSocket bridge/client-core flow proven by the PoC, keep Metro on a single React instance, and make Expo SDK 54's Worklets Babel plugin resolvable under pnpm's strict dependency layout.
- 648c966: Make `moxxy mobile` phone-friendly by default: bind the mobile gateway on LAN, advertise the reachable Wi-Fi/hotspot IP in the QR, and keep loopback pairing as an explicit simulator/local-only opt-in.
- 648c966: Start the mobile app disconnected by default and clear any previously stored pairing URL/token on boot, preventing stale QR state from leaving the UI stuck in "Paired / connecting".
- 648c966: Make the full mobile plugin app use the working mobile bridge end to end: Expo web origins are allowed by `moxxy mobile`, QR pairing is WS-only via `ws(s)://...?t=token`, `@moxxy/client-transport-ws` exposes a closeable `makeWsApiHandle`, the standalone bridge exposes desktop-style desks/sessions, Expo Web NativeWind styles now render correctly, and the app now shows/selects real bridge sessions before chatting with the agent.

  Share the workspace/session registry across TUI, Desktop, and Mobile: sessions created outside a known workspace now land in the stable global `Moxxy` workspace, CLI/TUI persistence syncs session metadata into the registry, Desktop reads the same registry, and remote mobile clients can list/switch desks through the safe WS IPC allow-list.

  Harden the shared registry sync so tests and empty probe sessions do not leak into a real user profile: session persistence now honors `MOXXY_HOME`, `readIndex()` backfills missing first prompts from the JSONL log, CLI/TUI waits for a real user prompt before registering a session, stale session cwd values fall back safely, and desktop runner spawn errors no longer crash the main process.

  Keep legacy desktop sessions readable from Mobile by falling back to the desktop chat mirror when a registry session id has no matching core session log.

  Allow the shared chat store to retry loading a session transcript when an earlier read returned an empty page, so switching back to a persisted Desktop/Mobile session can recover history once the host is ready.

  Make session history recovery use the core session JSONL as the canonical source whenever it exists, repairing missing, empty, or partial desktop chat mirrors so older multi-session conversations open with their full transcript on Desktop and Mobile.

- 648c966: Allow mobile clients to continue the selected registry session instead of treating non-live sessions as read-only history.
- 648c966: Fix mobile session switching, archived-session read-only UX, and chat history scroll anchoring.
- 648c966: Sync desktop/mobile session state, auto-approve, and OpenAI cached-token usage for context meters.
- 648c966: Restore sticky session provider and model when desktop/mobile resumes a session.
- Updated dependencies [648c966]
  - @moxxy/sdk@0.16.1

## 0.14.11

### Patch Changes

- Updated dependencies [b19d401]
  - @moxxy/sdk@0.16.0

## 0.14.10

### Patch Changes

- 92fecb8: Close the cross-package hardening items deferred from the repo-wide sweep, with
  regression tests:

  - **Bugs:** `countNodes()` recursion → iterative (no RangeError on a deep AST);
    subagent `spawnAll` now settles all children (one child's setup failure no
    longer orphans its siblings); the runner socket path honors `$MOXXY_HOME`; the
    computer-control screenshot tool result is projected as a provider image block
    so the model can actually see screenshots; `MoxxyRequirement.version` narrowed
    to the plugin kind; `CompactorDef.compact` signature aligned; `isFileDiffDisplay`
    validation tightened.
  - **DRY:** `sleepWithAbort` / `nextBackoffMs` extracted into `@moxxy/sdk` (shared by
    the default and goal modes); the isolator shim + broker-op concurrency limiter
    single-sourced in `@moxxy/plugin-security` and applied to both isolators; desktop
    loopback ports hoisted to one module; a shared collab-store helper extracted.
  - **Accessibility / contract:** a global `prefers-reduced-motion` rule for inline
    transitions; real ARIA roles + roving focus + Escape + focus-restore on the
    anonymizer filter dropdown; zod schemas for the collab IPC channels.

- Updated dependencies [92fecb8]
  - @moxxy/sdk@0.15.2

## 0.14.9

### Patch Changes

- e762d40: Repo-wide worst-case hardening (audit-driven). A pessimistic re-audit of every
  package/app scored security, performance, code-quality, extensibility (+a11y on
  UI surfaces) and cataloged 757 findings; this resolves the high+medium+clear-low
  set with regression tests for the failure paths. Highlights:

  - **Security:** email-detector ReDoS made linear (bounded local-part + label
    count + windowed scan); IPv4-mapped-IPv6 SSRF bypass closed; `memory_*` and
    workflow `runId` path-traversal sanitized; cross-host redirects no longer
    replay `Authorization`/body; webhook filter-regex ReDoS bounded; capability
    isolation now also covers tools registered after `onInit`; recursive subagent
    fan-out capped.
  - **Robustness (no happy-path assumptions):** unbounded child/stdout/socket/grep
    buffers bounded (OOM); missing `'error'` listeners + per-call timeouts + abort
    wiring added across the WS transport, runner JSON-RPC, isolators, browser
    sidecar, MCP boot, and provider streams; stale-name/out-of-order resolves,
    malformed-JSON tool input, and corrupt on-disk caches now degrade instead of
    crashing.
  - **Accessibility:** real focus traps + focus restoration + ARIA/`aria-modal` +
    keyboard navigation + Escape across desktop modals/sheets, the shared
    `desktop-ui` Modal, the workflow canvas, and the TUI.
  - **Quality:** dead code removed (incl. the committed `apps/docs/.astro` cache),
    per-workflow schedule-sync isolation, scheduler invalid-timezone resilience,
    and worst-case regression tests throughout.

- Updated dependencies [e762d40]
  - @moxxy/sdk@0.15.1

## 0.14.8

### Patch Changes

- 0daee68: feat(collaborative): git-first execution with a parallel lock-coordinated fallback (invisible)

  The non-git path ran agents ONE AT A TIME (sequential) — slow, and it's why "the
  team doesn't respond" when a user runs in a plain folder (only one agent is ever
  live). Now the engine is git-first and always parallel, and picks the safest
  mechanism underneath without any user-facing jargon:

  - **Already a git repo** → worktrees + a clean, conflict-aware merge (unchanged).
  - **Plain folder** → we quietly `git init` + snapshot it, so it STILL gets full
    worktree isolation + merge. Most "plain folder" runs now go fully parallel.
  - **Git genuinely unavailable** (not installed, or init/commit throws) → agents
    run in PARALLEL in the shared workspace, coordinated by the file-lock board
    (claim-before-edit). ownedPaths are pre-seeded as locks; an overlap is surfaced.
  - **`concurrency: 'sequential'`** remains as the explicit one-at-a-time fallback.

  Safety (from adversarial review): the shared-workspace prompt is hardened —
  claim before EVERY edit, narrowest paths, claim both old+new on rename, one owner
  for shared/aggregator files, only rely on a teammate's released work; the
  architect is required to hand out DISJOINT ownedPaths. peer-read on the shared
  tree reuses the path-traversal guard.

  Tests: auto-init → git-parallel; forced no-git → cwd-parallel (not sequential, no
  git repo); explicit sequential; cwd-parallel pre-seed + overlap surfacing.

## 0.14.7

### Patch Changes

- d71bf6f: feat(collaborative): brief is a SUMMARY, not the transcript — with on-demand recall

  The brief dumped up to ~6KB of the raw conversation into BRIEF.md, and every one
  of the N spawned agents was told to read it — so each peer re-ingested the whole
  dialogue. Now:

  - **BRIEF.md is a concise summary** — the goal + key requirements/constraints/
    decisions — produced by a single coordinator-side LLM call (`summarize.ts`,
    a direct off-log `provider.stream`, mirroring the summarize-compactor) with a
    deterministic **heuristic fallback** when no provider is available, so a brief
    never sinks the run.
  - **The full conversation goes to `.moxxy-collab/CONVERSATION.md`** for ON-DEMAND
    recall — never auto-loaded into any agent's context. The prompts tell agents to
    read or grep it only when they need a detail the summary omits.

  Net: peers get the intent cheaply instead of paying for the transcript N times.
  Adds summarizer (provider/model guard, error/empty → null), brief, and prompt
  tests; the e2e run now asserts CONVERSATION.md is written.

## 0.14.6

### Patch Changes

- b226696: feat(collaborative): dynamic, cross-functional roles (not a pool of identical implementers)

  The roster could only ever be `architect | implementer`, and `readRoster`
  force-overwrote every proposed role to `'implementer'` — so the architect's
  team was always a flat pool of clones, the opposite of the "a PM, a designer,
  some developers, a QA, a writer" vision.

  - `AgentRole` is now open (`'architect'` stays reserved for the coordinator's
    planner; any other label is a free-form team function).
  - `readRoster` carries the architect's proposed `role` (sanitised; a proposed
    `'architect'` is coerced to `'implementer'` since that's reserved) instead of
    hardcoding `'implementer'`.
  - The architect prompt now tells it to assemble the RIGHT team for the
    deliverable (developer/designer/pm/qa/writer/researcher/editor/…), not to
    default everyone to "implementer". The peer prompt + seeded turn now lead with
    the agent's role so a writer writes, a designer designs, a QA reviews.

  Roles flow straight into the existing roster/archive/UI, which already render
  `role`. Adds tests that proposed roles are carried and the reserved role coerced.

## 0.14.5

### Patch Changes

- 8bc25e7: feat(collaborative): give every agent the whole goal + the conversation, not just its subtask

  Spawned agents booted fresh sessions seeded with only their one-line subtask, so
  they never saw the overall goal or the dialogue that produced it — and the
  `MOXXY_COLLAB_PARENT_TASK` env the coordinator already set was read nowhere.

  - The coordinator now distils the user's conversation into a compact, token-
    capped **`.moxxy-collab/BRIEF.md`** (goal + recent intent) and writes it into
    the scaffold before the architect runs, so it's committed into every worktree
    (parallel) or present in the shared dir (sequential) — the whole team inherits
    the real intent.
  - `moxxy agent` now reads `MOXXY_COLLAB_PARENT_TASK` and seeds each implementer's
    first turn with the overall goal + its sub-task + a pointer to the brief and
    contracts (the architect, whose sub-task already is the goal, just gets the
    pointer).
  - The shared agent prompt now tells every agent to read the brief first and to
    `recall()` prior knowledge + `memory_save` durable facts — so the team builds
    memory/recall for the larger work.

  The brief is a pure, unit-tested digest (most-recent turns, clipped, total-
  capped) so a long conversation still yields a small file.

## 0.14.4

### Patch Changes

- a2cb758: fix(collaborative): stop the 30-minute hang, the spawn crash, and worktree leaks

  Agentic-collaborative mode could freeze for the full wall-clock (30 min) or take
  down the whole runner. Three root causes, fixed:

  - **30-minute hang.** A spawned agent only reported a terminal hub status when it
    called `collab_done`. Every other way a turn can end (provider error, iteration
    cap, idle, stuck-loop) left the process idling as `connected`, so the
    coordinator polled the full wall-clock before giving up. Peers now report a new
    terminal `failed` status when their turn ends without `collab_done`, and the
    coordinator adds a short **boot deadline** plus reacts to an observed child
    exit — so failures surface in seconds, not after 30 minutes.
  - **Coordinator crash on a bad spawn.** The peer `spawn()` had no `'error'`
    listener, so a failed spawn became an uncaught exception. It is now captured as
    a normal exit + diagnostic.
  - **Leaks.** Worktrees and the run's socket dir are now cleaned up on every exit
    path (abort, 0-done, conflict), not just integrate()'s happy path. The
    sequential fallback now awaits a peer's real exit before starting the next, so
    two agents never edit the shared workspace at once.

  A `failed` agent also releases its file locks (like a crash), and agents now
  self-report `working` while a turn is in flight. Adds a deterministic
  fail-fast coordinator test and a real-process integration test that spawns the
  actual `moxxy agent` binary and asserts it registers and reports a terminal
  status (no LLM required).

## 0.14.3

### Patch Changes

- 0870222: feat(runner): paged `session.loadHistory` + complete authoritative log

  Add the runner-side foundation for retiring the desktop's dual chat history (the
  renderer will later read transcript history from the runner instead of its own
  NDJSON store).

  - New runner protocol method `session.loadHistory` ({ before, limit } →
    { events, prevCursor }) — newest-first paging over the runner's authoritative
    event history. Bumps `RUNNER_PROTOCOL_VERSION` to 10; the change is purely
    additive, so `MIN_COMPATIBLE_PROTOCOL_VERSION` stays at 1 and an older client
    still attaches. `RemoteSession.loadHistory` gates the call on the server
    reporting v10+ and throws a clear, actionable "update the CLI" error against
    an older runner — which the desktop catches to fall back to its existing
    NDJSON path, so no transcript ever goes blank. The desktop FLOOR is
    intentionally NOT raised (the fallback keeps an older runner working); the
    release-build lockstep guard now allows the floor to lag an additive,
    version-gated runner bump.
  - `@moxxy/core` gains a PAGED JSONL reader (`readSessionEventPage` + the pure
    `pageEvents` helper) that reads one `(before, limit)` page WITHOUT
    re-materializing the whole log, so `loadHistory` works even when the log isn't
    all in memory. Read-only — it preserves persistence's atomic-write + mutex
    invariants (it never mutates the file).
  - Log completeness: when a turn streams assistant text but the provider never
    seals it with an `assistant_message` (e.g. an error/abort mid-stream — the
    case the renderer used to paper over by synthesizing a message that lived in
    no runner log), the runner now persists a REAL `assistant_message` on turn
    completion so its log is the complete authoritative history. Behavior-
    preserving for the normal sealed path.

## 0.14.2

### Patch Changes

- cbf115b: refactor(channel): close the runner/thin-client dispatch typing seam

  Add a single, audited `startChannelWith(channel, { session, ...overrides })`
  helper to `@moxxy/sdk` that owns the one structural erasure at the
  channel-dispatch boundary (`ChannelDef`/`Channel` are intentionally non-generic
  over their start-options type, so `start` takes `unknown`). The helper's
  signature now type-checks that every caller passes a real `ClientSession`, so a
  bare `RemoteSession` (the thin-client proxy) is proven assignable end-to-end
  even though the final hand-off to `start()` stays erased.

  Retarget the four CLI dispatch sites (`serve`, `web-surface`, and both the
  RemoteSession and in-process-Session paths in `start-registered-channel`) to
  call it, removing their inline `as never` casts, and add a compile-time
  conformance lock so a future regression that narrows `RemoteSession` or the
  concrete `Session` below `ClientSession`/`SessionLike` becomes a type error.
  No wire-shape or runner-protocol change.

- cbf115b: fix(cli): drain persistence + close the session on one-shot command exit

  One-shot commands (`moxxy -p`, `moxxy schedule run`, `doctor`, `login`, `init`)
  booted a full session and returned without closing it, so the process relied on
  the event loop draining — open webhook/scheduler/timer handles delayed (or hung)
  exit, and the last appended event could still be in flight when the process
  ended. Add a shared `closeSession(session, persistence?)` helper that drains the
  index write (`flush`) + the append queue (`settleWrites`) so the LAST event is
  durably on disk, then fires `onShutdown` hooks / stops the boot daemons via
  `Session.close()`. Each command now calls it in a `finally` (preserving its exit
  code), so the process exits promptly without dropping the final event.

- Updated dependencies [cbf115b]
  - @moxxy/sdk@0.15.0

## 0.14.1

### Patch Changes

- 43d3874: Security + correctness audit of the newly-merged features (collab / anonymizer / mini-apps)

  Applied the quality sweep to the features that landed during it. Real bugs fixed,
  each with a regression test:

  - **mode-collaborative (security, high):** path-traversal / arbitrary-file-read in
    the peer-read confinement — a `startsWith(dir)` prefix check let a peer agent
    read sibling-dir files outside its worktree. Replaced with segment-aware
    containment (`resolve`+`relative`). Also fixed abort-listener leaks in the poll
    loops.
  - **plugin-collab (security/correctness):** `boardRelease`/`boardClaim` by public
    id skipped the owner check (lock-stealing + ownership-hijack across peers), and
    a crashed agent's file locks were never freed (deadlock). Ownership now enforced
    on the id path; crashed/killed agents release their claims.
  - **anonymizer (security/perf):** NER span aggregation mislocated short entities
    (a **PII-leak** — redacted the wrong region, left real PII), the worker leaked
    in-flight promises on teardown/error, and overlap resolution was O(n²). Fixed.
  - **app installer (security):** the asset download had no source allow-list (SSRF)
    and no size cap (disk-fill DoS); both added. The `moxxy-app://` protocol handler
    was audited and confirmed escape-proof.
  - mini-apps framework + collaborate UI: worker-leak fix, IPC boundary Zod test
    coverage, and extracted/tested pure render helpers.

## 0.14.0

### Minor Changes

- 2673fa0: Wire the desktop Providers reasoning-effort selector live: it now maps onto the runner's `config.context.reasoning` instead of dead-ending in localStorage. Adds a `session.setReasoning` runner protocol method (v9) + a `settings.setReasoning` IPC command, surfaces `supportsReasoning` on `ProviderEntry` (derived from the runner's model catalog) so the selector only renders where it's honored, and removes the unchecked `(p as { supportsReasoning? })` cast.

### Patch Changes

- 2673fa0: Quality sweep: close the last deferred audit items

  - **`RequirementChecker.targetInfo`** is now table-driven (`TARGET_DESCRIPTORS`
    record, byte-identical to the old per-kind switch, with compile-time
    exhaustiveness). Closes the types-generics-5 table-drive item.
  - **Voice-admin** is extracted into a first-class `@moxxy/plugin-voice-admin`
    package (tools moved verbatim, registered via the cli builtin entries like the
    other plugins). Closes u28-3.
  - **Reasoning-effort** is now wired end to end: the desktop Providers selector
    flows through a typed IPC command to the runner's `config.context.reasoning`
    (runner protocol bumped to v9 in lockstep with the desktop floor), instead of
    persisting to local state and silently doing nothing. Closes the long-standing
    reasoning TODO (audit c15 / R1).

## 0.13.2

### Patch Changes

- 50a5b38: Quality sweep — single-source the `MOXXY_PCM16_24KHZ_MIME` wire constant (`u35-2`)

  Behavior-preserving (same string `audio/x-moxxy-pcm16-24khz`). The cross-package
  PCM16 MIME protocol tag was independently redeclared as a literal in three
  consumers; they now import the SDK's hoisted source of truth instead:

  - New dependency-free `@moxxy/sdk/transcriber` subpath export (mirrors
    `./tool-display`) so the browser/RN `@moxxy/client-platform-web` package can
    value-import the constant without dragging `node:*` builtins from the main
    barrel. `transcriber.ts` is pure (consts + interfaces, zero imports), so the
    subpath stays browser-safe.
  - `@moxxy/client-platform-web` (`src/pcm16.ts`) re-exports the constant from
    `@moxxy/sdk/transcriber`; gains `@moxxy/sdk` as a dependency.
  - `@moxxy/plugin-stt-whisper` (`src/audio.ts`) imports + re-exports from
    `@moxxy/sdk`, keeping its existing public surface stable.
  - `@moxxy/plugin-cli` (`src/session/use-voice-input.ts`) imports from
    `@moxxy/sdk`, dropping the inline literal.

  No protocol bump; no cycles (`check:deps` clean); SDK keeps zero internal deps.

- 50a5b38: Quality sweep — additive `@moxxy/sdk` surface + context-fold dedup

  Three purely-additive SDK changes (no removals, zero new internal deps):

  - `MOXXY_PCM16_24KHZ_MIME` (u35-2): hoisted the cross-package PCM16/24 kHz wire
    MIME tag — previously redeclared as a bare literal in client-platform-web,
    plugin-stt-whisper, and plugin-cli — onto the SDK's typed transcriber surface
    as the single source of truth, with a lock test pinning the exact bytes.

  - `runManualCompaction` (u80-2): a thin, log-first manual-compaction helper
    (compactor + log + provider/model + window → `{ compacted, tokensSaved,
eventsCompacted }`) so `/compact` can share the SDK's compaction flow instead
    of hand-rolling it. `runCompactionIfNeeded`'s signature/behavior is unchanged.

  - `computeElisionState` memo + threaded elision state (complexity-hotspots-7 /
    u122-2): the pure fold is now memoized on the input snapshot's identity, and
    `runElisionIfNeeded`/`runCompactionIfNeeded` derive one `ElisionState` per
    iteration and thread it into `estimateContextTokens` (and, opt-in, into
    `projectMessages`) — collapsing the ~3x-per-iteration re-fold to one.
    Byte-identical: the golden elision/projection tests still pass, plus a new
    memo-correctness test (same snapshot → cached state; any new array →
    recompute, never stale).

- 50a5b38: Quality sweep — split Node-only `@moxxy/sdk` helpers behind a `./server` subpath (browser/RN boundary)

  Purely structural, behavior-preserving (`t2-sdk-server-subpath`, retires TECH_DEBT #13):

  - New `@moxxy/sdk/server` subpath export. The Node-runtime VALUE helpers that
    statically reach `node:*` builtins — `spawnCliTunnel`/`isCliTunnelAvailable`
    (`node:child_process`), `writeFileAtomic`/`writeFileAtomicSync`/`moxxyHome`/
    `moxxyPath` (`node:fs`/`os`), `readRequestBody`/`bearerTokenMatches`
    (`node:http`/`crypto`), and the channel-auth helpers (`resolveChannelToken`/
    `rotateChannelToken`/`bearerGuard`/`encodeWsBearerProtocol`/
    `tokenFromWsProtocolHeader`/`MOXXY_WS_SUBPROTOCOL`/
    `MOXXY_WS_BEARER_PROTOCOL_PREFIX`) — now live on `@moxxy/sdk/server` and are
    dropped from the main barrel. The corresponding pure TYPE exports
    (`TunnelHandle`, `WriteFileAtomicOptions`, `ChannelTokenOptions`, …) stay on
    the main barrel (erased at build time). The main barrel + `./tool-display`
    subpath are now provably free of Node builtins, so a browser/React-Native
    bundle can value-import from them safely.

  - Every Node-side consumer re-pointed from `@moxxy/sdk` to `@moxxy/sdk/server`
    for those symbols (cli, core, desktop-host, channel/oauth/webhooks/mcp/
    workflows/scheduler/vault/memory plugins, ipc-server-ws, config, testing,
    apps/desktop/electron).

- 50a5b38: Quality sweep — workflow retry contract + DAG concurrency claim (plugin-workflows)

  - **`onError: 'retry'` is now behaviorally distinct (u117-3):** the DAG executor
    gates retries on the three-valued `onError` contract — `'retry'` runs
    `1 + retries` attempts, while `'fail'` and `'continue'` run **exactly one**
    attempt regardless of `retries`. Previously retries fired whenever
    `retries > 0` independent of `onError`, so `onError: 'fail' + retries: 3`
    silently retried (a latent trap). Schema/draft docs note the gate; new
    regression tests pin the attempt count for each mode.

  - **DAG wave-concurrency claim corrected (u117-1):** the executor description and
    scheduler comment now plainly describe the strictly-sequential within-wave
    execution (`concurrency` caps the batch drained per pass, not wall-clock
    latency) instead of implying parallelism is merely "deferred". Concurrent
    execution of even the pure steps cannot preserve the observable contract
    (atomic per-step event pairs in wave order, hard-failure-stops-the-rest-of-the-
    wave error semantics, wave-ordered `vars` merges), so the behavior is left
    sequential by design. No runtime behavior change for this item.

- Updated dependencies [50a5b38]
- Updated dependencies [50a5b38]
- Updated dependencies [50a5b38]
  - @moxxy/sdk@0.14.5

## 0.13.1

### Patch Changes

- 897a1fc: Quality sweep, wave 7 (review long-tail triage — final cluster)

  Triaged the audit's low-severity review long-tail: fixed the genuine
  correctness/robustness items (each behavior-preserving + a regression test) and
  consciously declined the subjective/stale nitpicks with a recorded rationale.

  Representative fixes: OAuth `countTokens` now refreshes a near-expiry token
  (was silently degrading to the estimate); desktop `ConnectionScreen` handles a
  rejected (not just `{ok:false}`) update promise and names the real cause;
  `BrowserPane` `preventDefault`s the keys it forwards; `useStepFlow` pins the
  cursor to the shown step id so a late-applying step can't bounce the user; plus
  assorted small robustness fixes across core/cli/plugins. Also replaced bare
  `Function`-typed test casts with proper signatures (net lint improvement).

  This is the last audit cluster — every finding in
  `.claude/audits/quality-sweep-findings.json` is now either fixed or consciously
  resolved with a rationale.

- Updated dependencies [897a1fc]
  - @moxxy/sdk@0.14.4

## 0.13.0

### Minor Changes

- 27bfaf6: feat(collaborative): agentic collaborative mode — a team of separate agents working in parallel

  A new selectable `collaborative` mode runs a _team_ of full, **separate** agent
  runner processes on one task (instead of in-process subagents). An **architect**
  agent designs the plan + shared **contracts** and proposes the roster (you
  approve/adjust); **implementer** agents then build in parallel, each in its own
  git **worktree**, coordinating over a new cross-process **collaboration hub**:

  - **`@moxxy/plugin-collab`** — the hub: a unix-socket message bus, a task board
    that doubles as an exclusive **file-lock** arbiter, a **contract registry**
    (publish → propose-change → ack → commit), **peer-read** (one agent reads
    another's in-progress files), crash detection, and **human step-in**
    (pause / resume / directive) — plus the peer `collab_*` tools and the
    `/collab_say` `/collab_direct` `/collab_pause` `/collab_resume` commands.
  - **`@moxxy/mode-collaborative`** — the coordinator (`collaborative`) + the
    internal `collab-architect` / `collab-peer` modes, the peer-process supervisor,
    the git worktree + **staged, ownership-resolved merge** engine (the user's
    branch is only advanced on a clean, atomic promote; conflicts never leave
    markers), and a user-configurable `CollabConfig`. Falls back to a **sequential
    single-workspace** run when git is unavailable (e.g. desktop users without git).
  - **`moxxy agent`** — an internal headless peer-runner subcommand.
  - **UI** — a folded `CollaborationBlock` in `@moxxy/chat-model`; an inline
    team-summary card in chat; and a dedicated **Collaborate** desktop workspace
    (agents · tasks · contracts rail, a `# All` / `@agent` channel selector, and a
    step-in composer) plus a compact TUI `collab` view.

  No runner-protocol bump (the hub has its own versioned protocol; collaboration
  events ride the existing `plugin_event` stream).

## 0.12.8

### Patch Changes

- 5f20dab: Quality sweep, wave 6 (god-file decomposition — atomic modules)

  Behavior-preserving structural refactor: the largest god-files are split into
  focused, single-responsibility sibling modules and re-exported from their
  original paths, so every existing import and the public API are byte-identical
  (verified by typecheck + check:deps + the existing test suites).

  - runner: `RemoteSession` (1145→789 LOC) → per-surface `client-views/*`;
    `RunnerServer` (781→509 LOC) → per-domain `handlers/*`. Wire protocol unchanged.
  - `@moxxy/sdk`: `mode-helpers.ts` (797 LOC) → `mode/{project-messages,collect-stream,single-shot,stuck-loop,stable-hash}.ts`, barrel exports byte-identical.
  - plugin-workflows DAG executor, plugin-webhooks tools, plugin-self-update
    core-tools split into per-concern/per-tool modules.
  - desktop: electron `main/index.ts`, `WorkflowCanvas.tsx` (→ `canvas-graph` +
    camera/drag hooks), `Composer.tsx` decomposed; pure helpers now unit-tested.
  - `desktop-ipc-contract` barrel split into per-domain files (re-exported).
  - cli `setup/builtins.ts` + `setup/workflows.ts` decomposed into composables.
  - core `PluginHost` registration/unregistration is now driven by one
    `REGISTRY_KINDS` table (was 2 parallel hardcoded 16-entry lists); shared
    `PluginHostOptions` extracted to a leaf to keep the host/table dependency
    one-directional (no import cycle).

  Cross-package moves (e.g. relocating voice tools to a new package) were
  deferred — they change package boundaries and belong in their own PRs.

- Updated dependencies [5f20dab]
  - @moxxy/sdk@0.14.3

## 0.12.7

### Patch Changes

- ff73468: Quality sweep, wave 5 (safe longtail — coverage + mechanical consistency/perf)

  The additive/mechanical slice of the audit's low-severity long-tail; subjective
  nitpicks and anything behavior-risky were deferred (tracked in `TECH_DEBT.md`).
  Behavior-preserving except the small fixes noted, each covered by a test.

  - **Coverage:** focused unit tests for previously-untested pure logic —
    command-palette parsers, chat suggestions, prompt reducer + escape-sequence
    matcher, slash-command matcher, config appliers, provider-admin `configure`,
    url-safety scheme table, vault placeholder resolution, and more.
  - **Mechanical consistency/perf:** resolve vault object properties concurrently
    (key-order preserved), hoist per-row `stdout.columns`/`descWidth` reads out of
    the TUI tool list, drop a no-op identity `useMemo`, and a few small bounded
    fixes. A desktop latest-block cache-key bug (64-char-prefix collision) was
    fixed while adding its test.

## 0.12.6

### Patch Changes

- 091ef41: Quality sweep, wave 4 (Tier-3 safe subset — coverage + mechanical cleanup)

  Largely additive and behavior-preserving (every behavioral change is tested):

  - **Test coverage** for previously under-tested critical subsystems: core surface
    host multiplexer, runner surface RPC + `surface.data` broadcast, desktop-host
    git porcelain/diff + provider-discovery + prefs + onboarding + surface relay,
    config loader, skill-draft fence extraction, and more.
  - **Real bugs found while adding coverage:** desktop-host git `-z` rename parsing
    emitted a phantom `ChangedFile`; untracked-file diff used a hardcoded POSIX
    `/dev/null` (now `os.devNull`); `fetchProviderModels` could hang (now a 15s
    `AbortSignal.timeout`).
  - **Mechanical cleanup:** removed proven-dead exports/params, tightened weak
    types (dropped `as never` / unchecked double-casts, exhaustive switches),
    consolidated duplicated `<NAME>_API_KEY` slug + config up-walk helpers.

  Risky/voluminous Tier-3 (god-file decomposition, the long-tail review/test-gap/
  consistency/perf clusters) remains tracked in `TECH_DEBT.md` as the standing
  journal.

- Updated dependencies [091ef41]
  - @moxxy/sdk@0.14.2

## 0.12.5

### Patch Changes

- 640d036: Performance pass (audit-driven, golden-tested for byte-identity)

  Algorithmic-complexity fixes; every algorithm-shape change is guarded by a test
  asserting the new path is byte-identical to the old, so behaviour is unchanged.

  - **Event log / projection (`@moxxy/sdk`, `@moxxy/core`, `@moxxy/runner`):**
    index `EventLog.ofType`/`byTurn` (O(n) filter → O(matches), property-tested
    equal to the old filter); `applyLazyTools` single-partition + index-backed
    loaded-tool scan; `projectMessages` binary-cursor compaction-range lookup;
    `computeElisionState` fused passes + no redundant sort; `surfaceInputParamsSchema`
    O(keys) size guard instead of `JSON.stringify` per frame.
  - **Chat-model block fold (`@moxxy/chat-model`, `@moxxy/client-core`, TUI,
    desktop):** the O(n²)/turn re-fold is now incremental — only the unsettled tail
    re-folds, keyed on a high-water mark — with a golden test feeding events one at
    a time and asserting deep-equality with a full re-fold after every event. Bounds
    the live in-memory log / `seenIds` / `usage.perCall`; memoizes the workflow
    canvas topology so a node drag no longer recomputes it per pointer-move.
  - **Quadratic / unbounded hotspots:** `UsagePanel` peak via reduce (was a
    `Math.max(...series)` spread that RangeError'd on long sessions), `grep` file
    size cap + binary skip, `StreamingPreview` incremental last-line (fixed an
    infinite loop on leading-newline content), terminal sentinel-regex compiled
    once + tail scan, webhooks parse-body-once, scheduler batched schedule
    reconcile, `runProcess` concat-once, and a one-time session-log `ensureReady`.

- Updated dependencies [640d036]
  - @moxxy/sdk@0.14.1

## 0.12.4

### Patch Changes

- 1e1b1d3: Fix the desktop agentic surfaces being undrivable: you couldn't type into the
  terminal and the browser wouldn't navigate.

  - **Surfaces were destroyed out from under their viewer (core).** A surface is
    shared (the agent's tool + the viewer drive one PTY/page), but `SurfaceHost`
    tore the instance down on the first `close`. React StrictMode (dev) makes that
    routine: it mounts → unmounts → remounts, so the first mount's late-resolving
    `open` fires a `close` that destroyed the instance the remount had just
    attached to. Output kept flowing (from the snapshot) so it looked alive, but
    `surface.input`/`surface.resize` then hit a missing instance and were silently
    dropped — no typing, no navigation, no resize, no error. Fixed with viewer
    ref-counting: the instance is only torn down when the last viewer detaches.
  - **Terminal mounted at the wrong width (desktop).** The context rail animated
    its width open, so xterm's `fit()` measured a mid-slide sliver and the shell
    drew its prompt hard-wrapped narrow (which xterm won't reflow). The rail now
    snaps open so the pane is full-width at mount; the fit is rAF-debounced +
    width-guarded, and the terminal is focused on attach.

## 0.12.3

### Patch Changes

- e1fb6a6: Move the copy-pasted Markdown + YAML-subset frontmatter mini-parser into
  `@moxxy/sdk` as a single canonical, zero-dependency module
  (`parseFrontmatterFile` / `parseFrontmatter` / `renderFrontmatter`). It was
  duplicated almost line-for-line between `packages/core/src/skills/parse.ts` and
  `packages/plugin-memory/src/parse.ts`, and the two copies had diverged: the
  plugin-memory copy split inline arrays on bare commas and dropped null/float
  typing.

  The shared module keeps the more-correct `core` behavior — depth- and
  quote-aware inline arrays, `null`/`~`, and float parsing — so both packages now
  share one source of truth with identical parse output (same fields, same
  missing/blank-frontmatter handling, same body offset). `core` and
  `plugin-memory` re-export from the SDK under their existing public names
  (`parseSkillFile`/`ParsedSkillFile`, `parseMdFile`/`ParsedFile`); call sites and
  on-disk formats are unchanged. Adds golden tests pinning the prior behavior.

- e1fb6a6: Add a generic `createJsonFileStore` block to `@moxxy/sdk` capturing the repeated
  whole-file JSON id-collection skeleton (in-memory cache + per-instance write
  mutex + read-modify-write `.slice()` copy + crash-atomic `writeFileAtomic`),
  with parsing/validation and corruption policy supplied by the caller's `load`
  hook so each store keeps its exact on-disk format and error handling.

  Migrate the scheduler and webhooks stores onto it (behavior unchanged: same
  `{ version: 1, … }` pretty-printed format, same silent-reset vs.
  preserve-aside/quarantine corruption policy, same 0600 quarantine sidecar). Fix
  the workflows run-store's non-unique `${file}.tmp` write by routing it through
  the shared `writeFileAtomic` (pid+uuid temp → no concurrent-writer collision,
  no orphan temp on failure).

  The vault store (encrypted, passphrase-keyed, 0600) and the provider-admin
  store (name-keyed, versionless, trailing-newline format) are intentionally left
  on their existing — already invariant-compliant — `createMutex` +
  `writeFileAtomic` since they are not id-collections.

- e1fb6a6: Quality sweep, wave 2 (audit-driven, all gates green)

  Continues the 2026-06-18 monorepo sweep (`.claude/audits/`). Behavior is
  unchanged except for the documented bug fixes; every fix ships with a test.

  - **Dedup/generics onto shared homes:** route home-path derivations through the
    SDK `moxxyHome`/`moxxyPath` (fixes a latent `MOXXY_HOME` mismatch), one shared
    `refreshAndStore` for OAuth, a shared external-store helper in client-core, and
    one-shot provider calls routed through the shared SDK collector.
  - **Confirmed logic/correctness fixes (~50):** workflows (yaml block-scalar
    comment corruption, loop-exit determinism, hard-failure wave break, nested
    awaitInput, resume re-emit, sibling-name run resolution, paused-run reporting),
    desktop/client (SkillsView edit-clobber, command-palette dispatch, StrictMode
    double-IPC, ask-respond failure recovery, onboarding unhandled rejection, mic
    stream leak), and assorted fixes across core/cli/channels/providers/isolators.

- Updated dependencies [e1fb6a6]
- Updated dependencies [e1fb6a6]
  - @moxxy/sdk@0.14.0

## 0.12.2

### Patch Changes

- 89ad994: Repo-wide quality + performance sweep (audit-driven, all gates green)

  A monorepo audit (report in `.claude/audits/quality-sweep-2026-06-18.md`) drove
  three test-backed waves. Behavior is unchanged except for the bug fixes below.

  **SDK (new public helpers):** `assertNever`, `writeFileAtomicSync`,
  `compareSemver`/`parseSemverCore`, and `countNodes` are now exported from
  `@moxxy/sdk` as the single home for those patterns.

  **Dead code & consistency:** removed the orphaned CDP screencast plumbing in
  `plugin-browser` and ~16 other proven-unused exports/modules; replaced the only
  banned private-field-poke cast with a DI seam; deduped repeated helpers onto
  shared homes (SearchBox, diff helpers, token estimate, semver, countNodes).

  **Security / correctness fixes:** view-spec `isSafeViewUrl` whitespace XSS
  bypass (parser + renderer walls); capability-broker SSRF-via-redirect,
  symlink/TOCTOU, and unbounded-buffer hardening; permission deny-rules now fail
  closed on an invalid regex; OAuth refresh race + stale-token-field fixes;
  isolator SIGKILL escalation, cwd, and abort-signal wiring; bounded validation on
  remote-reachable IPC commands; refusal to overwrite a built-in provider; an
  unbounded `completedTurns` leak; and several resource/timer/listener leaks.

  **Generics & atomicity:** extracted `ActiveDefRegistry`/`DefMapRegistry` bases
  (8 copy-paste registries → thin subclasses) and `defineOpenAICompatProvider`
  (per-vendor copy-paste collapsed); closed invariant-#5 gaps by adding
  per-instance mutexes + atomic writes to the file-backed stores that lacked them.

  Larger/riskier items (the O(n²) chat-model fold rewrite, a generic JSON store,
  god-file splits, and the long-tail findings) are tracked in `TECH_DEBT.md` for
  focused follow-up PRs rather than bundled here.

- Updated dependencies [89ad994]
  - @moxxy/sdk@0.13.0

## 0.12.1

### Patch Changes

- 22b2c3c: Fix three bugs in the desktop agentic surfaces (terminal / browser / resizable rail):

  - **Rail wasn't resizable.** The drag handle is absolutely positioned, but
    `.col-rail` had no `position`, so it anchored to a far ancestor and landed
    off-screen — the divider looked draggable but nothing grabbed it. Anchor the
    handle to the rail, keep it inside the clip box, and drop the width transition
    mid-drag so the rail tracks the pointer 1:1.
  - **Terminal was shredded and unusable.** xterm's `fit()` ran synchronously on
    mount while the rail was still sliding open (≈0 width), locking the terminal —
    and the PTY it resized — to ~1–2 columns, so every character wrapped. Fit only
    once the pane has real layout (deferred + `ResizeObserver`-driven, width-guarded),
    and focus the terminal once the surface is attached so typing works immediately.
  - **Browser was stuck on "Loading…".** The CDP `Page.startScreencast` push emits
    no frames for a blank/static/headless page and swallowed its own failure, so the
    pane spun forever. Stream the page by polling a JPEG `frame` (always yields a
    frame, works on any Playwright browser) and surface a real error/launch status
    instead of an indefinite spinner.

## 0.12.0

### Minor Changes

- 33e9640: Agentic surfaces: repurpose the desktop context rail into a dropdown of shared,
  agent-drivable panes.

  - New swappable **Surface** block in the SDK (`defineSurface`, `SurfaceRegistry`,
    `SurfaceHost`) + runner protocol **v8** (`surface.*` methods + `surface.data`
    stream) so a runner-owned interactive resource (a PTY, a browser page) streams
    to a thin client and takes its input back — no reverse RPC.
  - **Terminal** (`@moxxy/plugin-terminal`): a shared shell the user and the agent
    drive together via a new `terminal` tool; rendered live with xterm.js. Ships a
    real PTY via node-pty (optional native dep, N-API) with a dependency-free
    piped-shell fallback.
  - **Browser**: a live, in-window view of the agent's Playwright page on
    `@moxxy/plugin-browser`, streamed over a CDP screencast (`Page.startScreencast`)
    — the user and agent share one page; clicks/keys/scroll/navigation are proxied
    to it.
  - **Files changed**: a git-aware file list with the diff on the right; clicking a
    file opens a dropdown to Add it to the agent or Open it (diff/content). New
    `workspace.readFile` + `git.{isRepo,status,diff}` desktop IPC.
  - The context button now opens a dropdown (Terminal / Files changed / Browser)
    instead of toggling; the rail is drag-resizable with a persisted width.

- 143264a: Desktop OAuth providers now sign in for real instead of showing a "run `moxxy login` in a terminal" hint.

  Settings → Providers (and the onboarding wizard) drive a shared `OAuthSignIn` flow that spawns `moxxy login <provider>`, opens the browser, and — for out-of-band providers like `claude-code` — collects the pasted `claude setup-token` or `code#state` in the UI (browser-authorize primary, token paste as a fallback). Loopback providers (openai-codex) keep their automatic browser+callback flow.

  Mechanics: `moxxy login --stdin-prompts` relays each interactive prompt to the host as a NUL-bracketed marker on stdout (new `encodeLoginPrompt` / `createLoginStreamScanner` in `@moxxy/sdk`) and reads answers as stdin lines, so a GUI host can drive the paste flow without a TTY. The desktop exposes this via new `provider.login.start` / `answer` / `cancel` IPC commands and `provider.login.prompt` / `output` / `done` events; the dead `onboarding.runProviderLogin` command was removed. `onboarding.providerAuthKind` now derives a provider's auth kind from the runner's registry (fixing `claude-code` being mis-detected as an API-key provider) instead of a hardcoded list.

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

## 0.11.0

### Minor Changes

- 9f86a7b: Add four built-in LLM providers, available out of the box (no `provider_add`
  needed) and selectable in `moxxy init` / the `/model` picker:

  - **z.ai (Zhipu GLM)** in two modes — `zai` (pay-as-you-go, OpenAI-compatible
    endpoint) and `zai-coding-plan` (GLM Coding Plan, Anthropic-compatible
    endpoint, like Claude Code). Catalog: GLM-5.2 (1M context), GLM-5.1, GLM-5,
    GLM-4.6, GLM-4.5 family, GLM-4.5V (vision).
  - **xAI (Grok)** — `xai`, OpenAI-compatible. Catalog: grok-4.3 (1M context),
    grok-4, grok-4-fast, grok-code-fast-1, grok-3, grok-3-mini.
  - **Google Gemini** — `google`, via Gemini's OpenAI-compatibility endpoint.
    Catalog: gemini-3-pro/flash, gemini-2.5-pro/flash/flash-lite.
  - **Local models** — `local`, any OpenAI-compatible local server (Ollama by
    default, or LM Studio / llama.cpp / vLLM via `LOCAL_MODEL_BASE_URL`). Needs no
    API key.

  Also refreshes the Anthropic model catalog with the latest Claude models
  (Claude Fable 5, Opus 4.8, Opus 4.6 alongside the existing Opus 4.7, Sonnet 4.6,
  Haiku 4.5), which the `anthropic` and `claude-code` providers both pick up.

## 0.10.0

### Minor Changes

- aacdf1d: Desktop: live registry refresh + interactive provider management.

  The runner now broadcasts `info.changed` after every completed turn, so registry changes made by tools inside a conversation (provider_add, mcp_add, workflow_create, skill writes, …) reach attached clients; the desktop forwards the push to the renderer (`session.info.changed` → `SESSION_INFO_REFRESH_EVENT`) and the Settings panel re-fetches live — no more app restart to see an agent-added provider.

  Settings → Providers is now interactive: enable/disable any provider (runner protocol v7 `provider.setEnabled`, persisted to `preferences.json#disabledProviders` and honored by boot's activation walk; disabling the ACTIVE provider is refused), and a Configure sheet sets the API key (vault + live readiness re-probe via `provider.refreshReady`) and, for runtime-registered providers, the stored baseURL/default model (`provider.configure` through the new `SessionLike.providerAdmin` view). OAuth providers get a `moxxy login` hint instead of a key form.

### Patch Changes

- Updated dependencies [aacdf1d]
  - @moxxy/sdk@0.11.0

## 0.9.0

### Minor Changes

- fee0523: New `moxxy office` channel: a browser pixel-art office game where every animated worker sprite is a full moxxy session. Click a sprite to chat with that agent (streaming, tool calls, permission/approval prompts, slash commands, mode switching, abort); spawn new agents that walk in through the entrance; watch subagents gather in the war room and bubble their progress. Served over the standard authenticated WebSocket IPC bridge, so the game reuses the shared client layer.

### Patch Changes

- 1450973: Virtual office: mouse-wheel / trackpad-pinch zoom (anchored at the cursor) and drag-to-pan, clamped to the office map; sprite clicks now fire on pointer-up with a drag threshold so panning never opens the chat panel.
- 5ab6c78: Fix the WS bridge rejecting real iOS devices at the upgrade handshake. iOS React Native (SocketRocket) sends an `Origin` header derived from the WS URL it dials (ws→http, wss→https) — it is not a browser-only signal — so the Origin default-deny dropped every iPhone pairing with `moxxy mobile` or the desktop gateway. The bridge server now supports `setAllowedOrigins` on the live listener (a tunnel URL is only assigned after start), and both the mobile channel and the desktop mobile gateway allow-list exactly the origins of the URLs they advertise: the tunnel origin, the LAN/loopback connect-URL origin, and the loopback spellings for simulators. Default-deny for everything else is unchanged.

## 0.8.2

### Patch Changes

- 4c594d8: Wave of desktop/mobile fixes. Runner protocol v6 (additive): clients can supply the turn id (`runTurn.turnId`) so renderer per-turn filters actually match — fixing the silently-broken "generate skill with AI" flow and hidden-turn leaks — and `attach` gains a replay policy (`'full' | 'none' | { tail }`) with EventLog rebase so the desktop no longer replays full session history on app start/desk switch (history comes from the paginated NDJSON log). Desktop settings gain a shared "ask moxxy to do it" background-agent modal: the skill generator is refactored onto it and MCP servers and Providers get Add buttons driving `mcp_add_server`/`provider_add`, with permission asks surfaced in-modal (plus a global ask fallback outside the chat view). Subagents now inherit the parent's resolved model: hallucinated model ids warn and fall back, workflow-trigger spawns use the session's last resolved model, and hardcoded model-id fallbacks are gone. Clerk sign-in returns to the app instead of stranding on the hosted My-account page (explicit fallback redirect URLs + a main-process account-portal recovery handler). Workflow canvas: Delete/Backspace removes the selected node and dropping a connector on empty canvas opens an insert-node menu. Mobile: reconnects re-prime the connection store (fixes the deaf "Connected" state after a runner restart), gateway URL commits on blur, the redundant header actions toggle is gone, menu entries are chips, executed tools open a diagnostics panel on tap, and the QR scanner starts scanning immediately.

## 0.8.1

### Patch Changes

- ad989eb: Workflow builder UX: the canvas pans by dragging the background (grab cursor; node drag / connection drag / click-to-deselect unaffected), the header controls (Back / validity badge / Save) align to the name/description input row instead of floating centred, and schema validation errors read as plain English anchored to the step — `step "greet": prompt must not be empty` instead of `steps.0.prompt: String must contain at least 1 character(s)` — so the builder can pin them to the offending node card.

## 0.8.0

### Minor Changes

- 2796066: feat(workflows): human-in-the-loop awaitInput — resume RPC + operator reply UI (un-gate)

  A workflow step can set `awaitInput: true` to pause and ask the operator a
  question, then continue with their reply. #146 gated this at validate/save time
  because the resume path hadn't shipped. The resume path now ships, so the gate
  is removed.

  - **Un-gate:** `awaitInput: true` is accepted again on **prompt/skill steps**
    (rejected on tool/workflow/logic/loop steps and on a loop body); `draft.ts`
    teaches the mid-run pause flow again with a worked example.
  - **Resume RPC (additive, protocol v5):** new `RunnerMethod.WorkflowResume`
    (`workflow.resume`) — server handler → `session.workflows.resume(runId, reply)`;
    `WorkflowsView.resume` (SDK) + CLI impl over the existing `resumeWorkflowRun`;
    `RemoteSession` client method gated on server protocol `>= 5` with the actionable
    "update the CLI" error (mirrors the v4 builder gate). `MIN_COMPATIBLE` stays at 1.
  - **Desktop / mobile / TUI:** `workflows.resume` added to the desktop IPC contract
    (+ host handler), the MobileSessionHost bridge, and `REMOTE_ALLOWED_COMMANDS`
    (RESPOND-only — answering a question the workflow asked, like `ask.respond`).
    Operator reply UI: desktop paused-workflow card (new client-core
    `usePausedWorkflows` hook) and TUI inline reply in the `/workflows` panel.
  - **Correctness:** the `workflow_paused` event now carries the workflow name +
    step label + question; vars set before a pause survive the checkpoint round-trip;
    `runNow` keeps treating a `paused` result as non-terminal (and the resume side
    delivers the now-completed run to the inbox); the stale-checkpoint sweeper +
    `clearRetainedChildren()`-on-shutdown are kept.

### Patch Changes

- Updated dependencies [2796066]
  - @moxxy/sdk@0.10.0

## 0.7.3

### Patch Changes

- 4a8ec5d: Workflows round-2 correctness: gate the unshippable `awaitInput` resume, make the visual builder work on the desktop, and fix loop/validation correctness.

  **`awaitInput` is gated (was a hang-forever dead-end).** The executor can pause + checkpoint an `awaitInput` step, but the resume trigger/channel that delivers the operator's reply never shipped to `main` — `resumeWorkflowRun` had zero production callers. So an agent-drafted "ask me, then act" workflow would pause forever, leak a retained child session for the process lifetime, and orphan a checkpoint file. `awaitInput` is now **rejected at validate/save time** with a clear "requires the resume channel, not available in this build" message, and `draft.ts` no longer teaches it (it steers the author to `inputs` fields instead). Defense-in-depth: the CLI runner treats a `paused` result as non-terminal (no inbox delivery), `Session.close()` clears retained child sessions so they can't leak, and a `WorkflowRunStore.sweepStale()` sweeper (7-day TTL, run on workflows boot) reaps orphaned `~/.moxxy/workflow-runs/active/` checkpoints. The executor pause/resume path is kept intact so re-enabling is a matter of landing a resume trigger and removing the schema gate.

  **Visual builder works on the desktop now.** The desktop drives a `RemoteSession`, whose workflows view only forwarded `list`/`setEnabled`/`run` — so the builder's `validateDraft`/`save`/`getRun` were `undefined` and threw "not supported on this session". Added a `workflow.validateDraft|save|getRun` runner-RPC family (**protocol bumped to v4**) with RemoteSession client methods + server handlers, so the desktop builder validates/saves/loads against the runner.

  **Loop + validation correctness.** A condition/switch step used as a loop body is rejected (its branch routing was silently ignored). A non-loop-body step that `needs` a loop-body step is rejected (it would stall — body steps are excluded from the main DAG). A loop-body step's own `when` guard and any `needs` other than its loop step / a sibling body step are rejected (body steps run unconditionally each iteration). Logic-step `vars` now drop `__proto__`/`constructor`/`prototype` keys (prototype-pollution guard). Paused-run checkpoints persist + restore `vars` set before the pause. Renaming a workflow via the builder removes the old file/entry instead of leaving an orphaned duplicate (`save(workflow, previousName)`, threaded through the view → IPC → runner RPC → builder hook).

- 6afc4c0: Workflows engine (phase 1 of 2): port the logic-step + agentic-authoring engine onto current main, and add a bounded while-loop node.

  **Engine features ported.** `@moxxy/plugin-workflows` now supports logic steps — `bridge` (extract/transform upstream output into `vars`), `condition` (if/else gate routed by an LLM `{"branch":"then"|"else"}`), and `switch` (multi-way gate routed by case id) — plus a `format: json|plain` field, branch fields (`then`/`else`/`cases`/`default`), a persisted-only `ui.layout` schema (node x/y + viewport, no editor here), agentic YAML authoring (`draft.ts` `buildSystemPrompt`/`draftWorkflow` + the `workflow_create` tool teaching the full schema), LLM branch-predicate parsing (`logic-response.ts`), and `awaitInput` pause/resume for prompt/skill steps (`run-store.ts` checkpoints under `~/.moxxy/workflow-runs/active/` + executor `resumeWorkflowRun`). The DAG executor (`executor/dag.ts`) gains `runLogicStep`, `mergeVars`, `applyBranchSkips`, and an `ExecutorContext`, merged surgically onto main's baseline — main's `MAX_NESTING_DEPTH` guard and behavior are preserved, as is the CLI's separate inter-workflow `afterWorkflow` cycle guard (`MAX_AFTER_WORKFLOW_CHAIN`, Tarjan SCC). The SDK gains the matching types (`WorkflowLoopAction`, `WorkflowLogicStepFormat`, `WorkflowRunStatus`, `WorkflowUi*`, `awaitInput`, `retainSession`, `SubagentContinueArgs`); core's subagent runtime gains retained-session `continue()`/`release()` (new `run-child.ts` + `registry.ts`) backing the pause/resume flow.

  **New `loop` node.** A `loop: { body: string[], condition: string, maxIterations: 1..50 (default 10) }` action repeats its body steps in order each iteration (resetting their state per pass, honoring `onError`), then evaluates `condition` via the same LLM predicate as a `condition` step. `condition` is the loop's EXIT/GOAL condition — the body repeats UNTIL it is met: `then` = condition met → STOP (continue to the next step), `else` = not yet met → run another iteration. A body step error BREAKS the loop to the next step (the loop returns ok with a "broke on error" note rather than failing the whole workflow), unless that body step sets `onError: continue` (which swallows the error and keeps iterating). It is unmistakably safe: it terminates when the exit condition is met, when a body error breaks it, OR at `maxIterations` (finishing with a clear note, never hanging), and composes with `MAX_NESTING_DEPTH` (a body that calls nested workflows still bottoms out at the depth cap). The iteration cap and the depth cap are independent guards; neither can be defeated by the other. Schema rejects loops combined with `then`/`else`/`cases`/`default`, empty bodies, out-of-range `maxIterations`, unresolvable body ids, and `awaitInput` on a loop.

  **IPC for the upcoming visual builder (phase 2).** Additive, capability-detectable commands `workflows.validateDraft` (parse YAML → errors), `workflows.save` (persist a workflow), and `workflows.getRun` (fetch canonical YAML): zod-validated contract + a desktop-host pass-through handler + new optional `WorkflowsView` methods, with the mobile `MobileSessionHost` extended to parity. The visual builder GUI itself is phase 2 (follow-up).

- Updated dependencies [1e4ed09]
- Updated dependencies [4a8ec5d]
- Updated dependencies [6afc4c0]
  - @moxxy/sdk@0.9.0

## 0.7.2

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

- cf2f651: Provider-parity fixes from the 2026-06-09 audit (A36–A38):

  - **Codex (A36):** `req.maxTokens` now reaches the Responses API as `max_output_tokens`; `req.temperature` is documented-unsupported on the Codex backend (gpt-5 reasoning models reject sampling params) and dropped with a one-shot MOXXY_DEBUG note instead of silently; `reasoningEffort` is a live `CodexProviderConfig` option (was pinned to 'medium') and the CLI's codex credential resolver now passes `provider.config` through to the client instead of discarding it.
  - **Runtime openai-compat providers (A37):** registered vendors now report their own name + model catalog on the live client (usage stats / errors / context-window lookups no longer misattributed to 'openai'); vault/env key naming is unified behind `providerApiKeyName`/`storedProviderApiKeyName` in plugin-provider-admin — the CLI honors a stored `envVar` override and maps hyphens to underscores, matching the desktop; `provider_add` model descriptors can declare `supportsDocuments` so attachments stop degrading.
  - **`req.system` contract (A38):** hook-injected system text (e.g. plugin-memory's consolidation nudge) now actually reaches every provider — delivered in addition to system-role messages (anthropic: extra system block after the cache breakpoint; openai: inserted system message; codex: appended to `instructions`). The loop helpers no longer prefill `req.system` with the system prompt, which also removes a duplicated base prompt in codex `instructions`.

- cf2f651: Security: four audit leftovers (A43–A46). MCP server credentials now support `${vault:NAME}` placeholders in env/header values, resolved only at connect time (the persisted mcp.json and the model-visible tool args keep the placeholder; `mcp_add_server`/`mcp_test_server` instruct vault-first). Agent-view URLs are scheme-allow-listed (`https`/`http`/`mailto`/`tel` + relative; `data:image/*` for img src only) at BOTH walls: a canonical `isSafeViewUrl` in the sdk enforced by `parseView` and `validateDoc`, and a render-time re-check in the web frontend that neutralizes `javascript:`/`data:text` hrefs and srcs. `web_fetch` closes its DNS-rebinding TOCTOU by pinning every hop's connection to the SSRF-guard-vetted addresses via an undici dispatcher with a fixed lookup (SNI/cert validation intact). Telegram inline-keyboard callbacks now enforce the same pairing authorization gate as text/voice messages.
- Updated dependencies [cf2f651]
- Updated dependencies [cf2f651]
- Updated dependencies [cf2f651]
- Updated dependencies [cf2f651]
  - @moxxy/sdk@0.8.1

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
