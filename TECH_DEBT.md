# Tech debt — living journal

This is the repo's standing tech-debt ledger. **Treat it as a journal:** read it
before non-trivial work, retire at least one item per change, and log new debt the
moment you see it. See AGENTS.md → "Tech debt is a standing job".

**Pruned 2026-06-24** — the historical saga write-ups and all resolved/"Retired"
entries were compacted away; what remains below is the currently-OPEN backlog as a
scannable summary. Git history holds the full prior journal if you need it.

Severity tags: `[critical]`/`[high]`/`[med]`/`[low]`, `[note]` = standing practice
or recorded-on-purpose decision.

## Resolved ledger

- [low, ux, RESOLVED 2026-06-25] `SkillGallery` now uses the shared
  `<SearchBox />` primitive and has regression tests for filtering by name and
  description. `apps/desktop/src/settings/skills/SkillGallery.tsx`.
- [low, ux, RESOLVED 2026-06-26] Focus Mode's collapsed dark tile no longer
  exposes the white Electron webContents background at anti-aliased corners; the
  native focus window is shaped and the tile paints theme-aware backing color.
  `packages/desktop-host/src/focus-window.ts`,
  `apps/desktop/src/focus/focus-styles.ts`.
- [low, sessions, RESOLVED 2026-06-29] Resumed desktop sessions now hydrate
  stale sidecar titles from JSONL history and dedupe legacy `.meta.json` rows,
  so the workspace sidebar no longer falls back to duplicate/stuck
  `New session` labels. `packages/core/src/sessions/persistence.ts`,
  `packages/workspace-registry/src/index.ts`.
- [med, mobile, RESOLVED 2026-07-01] Moxxy Mobile Live Activity taps now route to
  an existing chat route, derive labels from real session/workspace state, and
  avoid false completion notifications on transient background disconnects.
  `apps/mobile/src/liveActivity.ts`,
  `apps/mobile/ios/MoxxyLiveActivityExtension/MoxxyLiveActivityWidget.swift`.
- [med, mobile, RESOLVED 2026-07-02] Moxxy Mobile now flushes the latest active
  Live Activity snapshot when iOS backgrounds the app, treats streaming assistant
  transcript as active work even when turn flags lag, dedupes same-session native
  ActivityKit activities, and keeps the lock-screen badge/detail compact.
  `apps/mobile/src/liveActivity.ts`,
  `apps/mobile/src/hooks/useMoxxyLiveActivity.ts`,
  `apps/mobile/ios/MoxxyMobileGateway/MoxxyLiveActivity.swift`,
  `apps/mobile/ios/MoxxyLiveActivityExtension/MoxxyLiveActivityWidget.swift`.
- [med, mobile, RESOLVED 2026-07-02] Moxxy Mobile active turns now reconcile
  missed lifecycle completion pushes from the runner's authoritative history,
  so a foregrounded/reconnected phone does not keep showing Thinking/Live
  Activity after desktop already received the final answer.
  `packages/client-core/src/chat-store/store.ts`,
  `apps/mobile/src/hooks/useGatewayStore.tsx`.
- [med, mobile, RESOLVED 2026-07-02] Moxxy Mobile reconnect recovery now also
  reconstructs missed turn starts from runner history and performs a one-shot
  foreground/reconnect refresh even before `activeTurnId` is known, so Live
  Activity can restart from authoritative state after the phone missed the
  `runner.turn.started` push.
  `packages/client-core/src/chat-store/store.ts`,
  `apps/mobile/src/hooks/useGatewayStore.tsx`.

## Standing practices

- **Own debt like a CTO** — read this file before non-trivial work, retire ≥1 item
  per change, log new debt on sight, re-audit subsystems during big work.
- **Rebuild after changes** — turbo cache makes `pnpm build` cheap; run it (and the
  gate) before reporting work done or rebasing onto main.
- **Keep the Claude skill library current** — `.claude/skills/` encodes repo
  conventions; when a convention/command/invariant changes, update the matching
  SKILL.md in the same PR.
- **YAGNI extension seams** — subagent retention constants, discovery concurrency,
  `credentialResolver` capability, per-owner browser sidecar registry, warm
  subprocess pool are consciously deferred (surface/risk for no current win);
  revisit when a concrete need appears.

## Sessions / workspace

- [low, scale] `desks.list` derives in O(N) `stat`s (one `readdir` + a `stat` per
  session file; parses only changed files via the mtime cache). Fine for hundreds–
  low thousands; at very large N a registry-level derived-cache invalidated by the
  sessions-dir watcher would make it O(1). `packages/core/src/sessions/persistence.ts`.
- [low, scale] `desks.changed` ships the full desk list (O(N) payload); a delta
  event (changed desk/session only) would cut cross-device payload to O(1). The
  projection-diff already suppresses per-event churn. `packages/desktop-host/src/sessions-watcher.ts`.
- [low] Standalone `moxxy mobile` empty-session source: seeded `source:'mobile'`,
  but the env-heuristic runner write can later stamp `tui`, dropping an empty
  session from the list until its first prompt. Set `MOXXY_SESSION_SOURCE=mobile`
  on the `moxxy mobile` runner to make it airtight. `packages/plugin-channel-mobile`.
- [note] Stress-test multi-session with a desk's SECOND (UUID) session — the first
  session has id === desk id, which masks pool-key regressions. `packages/desktop-host`.
- [low] `SessionSource` literals are still hand-listed in one runtime spot:
  `sessionSource()`'s validator in `packages/cli/src/setup/persistence.ts` (a type
  can't be enumerated at runtime). `DeskSession.source` in `@moxxy/desktop-ipc-contract`
  was unified onto the SDK type (2026-06-26); when adding a source, update the
  union in `@moxxy/sdk` event-store.ts AND that guard.
- [low] TUI `/sessions` switcher only works in self-host/standalone mode (the TUI
  owns the boot, so it can re-bootstrap onto a different session in place). In
  ATTACH mode (thin client against an external `moxxy serve`) the runner owns a
  single fixed session, so the switcher degrades to a notice. True attach-mode
  switching needs a runner-side session pool (like desktop's `RunnerPool`) or a
  spawn-a-second-runner flow; deferred as the larger architectural change.
  `packages/cli/src/commands/run-tui.ts`, `packages/plugin-cli/src/session/sessions-picker.ts`.
- [low] TUI `/sessions` switch re-runs the full `setupSessionWithConfig` per switch
  (re-discovers plugins, re-fires onInit daemons for the new session). Correct but
  not cheap; a warm-registry / session-pool reuse would make switching instant.
  `packages/cli/src/commands/run-tui.ts`.

## Mobile / Live Activity

- [med, mobile, PARTIALLY DONE] Moxxy Mobile's Live Activity can only update from
  local JS while the app process is alive. Local backgrounding now flushes the
  latest known active state, native duplicates are cleaned up, and foregrounded
  clients can recover missed starts/completions from runner history, but if the
  phone is already fully suspended before a desktop turn starts, iOS may pause
  the WS client before any local ActivityKit update can be sent. Confirmed on
  2026-07-02 with iPhone 17 Simulator: a desktop-gateway turn started while the
  mobile app was locked produced runner/tool events, but no lock-screen Live
  Activity or completion notification until the app was foregrounded. Remaining:
  correct end-to-end background fidelity needs a push-backed ActivityKit update
  path (per-activity push token + APNs update/end from a relay/host) or an
  equivalent server-side bridge.
  `apps/mobile/src/hooks/useMoxxyLiveActivity.ts`,
  `apps/mobile/ios/MoxxyMobileGateway/MoxxyLiveActivity.swift`.

## Runner / protocol & architecture

- [high, architecture] Retype channel handlers to the SDK contract — `ClientSession`
  still exposes the full concrete registry surface; retype handler params to a
  minimal `SessionLike` slice (and verify graceful degradation) alongside the
  runner/thin-client split. `packages/sdk/src/session-like.ts`, `plugin-cli`, `plugin-telegram`.
- [high, bug] `/new` desync window — renderer clears the store before the runner
  reset confirms; a failure/crash between them resurrects old context. Reset runner
  FIRST, clear on success (or one atomic IPC). **Zero tests** on this path.
  `packages/desktop-host/src/chat-log.ts`, `packages/runner/src/`.

## Desktop / native build & release

- [high] node-gyp 9 too old / 11 hangs `@electron/rebuild@3.6.1` ("preparing
  node-pty"). Real fix is a coupled bump: `@electron/rebuild` 4.x, electron-builder
  25→26, node-gyp 12, Node floor `>=20.17` — verified by an actual packaging run.
  Until then CI pins stay (Python 3.11 + windows-2022); use `verify-desktop-packaged`
  for any node-gyp change. `root pnpm.overrides`, CI.
- [med] Verify Tier-1 hot-update sticks on 0.0.30+; once verified, consider dropping
  the renderer-heartbeat confirm path (fast-path kept). `packages/desktop-host/src/app-update/`.
- [low] Pre-fix releases (≤ desktop-v0.8.0) carry mismatched GitHub asset names
  (manual repair); only new releases are correct.

## Desktop / surfaces & files

- [high, constraint] Surfaces are ref-counted — keep the per-kind refcount balanced
  if adding open/close call sites (a single viewer's close must not destroy a shared
  instance). `packages/core/src/surfaces/host.test.ts`.
- [constraint] Terminal sizing depends on the pane being full-width at mount — never
  push a transient/sub-full column count to a PTY-backed surface. `packages/core/src/surfaces/`.
- [dormant] CDP screencast → screenshot-polling fallback is unused — remove, or
  gate behind the polling fallback if screencast is revived. `plugin-browser/src/sidecar/`.
- [dormant] Piped-shell fallback is intentionally non-interactive — needs CR→LF +
  local echo if a no-prebuild platform ever needs it. `packages/core/src/surfaces/pty.ts`.
- [low] Files pane polls IPC instead of streaming via the Surface protocol — promote
  to a real Surface if a third live pane appears. `apps/desktop/src/shell/surfaces/`.
- [low] "Add to agent" on a git-changed file assumes cwd === repo root. `FilesPane.tsx`.
- [low] Terminal tool completion is sentinel-heuristic; a structured exec channel
  would be cleaner. `packages/plugin-terminal/`.

## Desktop / apps & send-to-chat

- [med] `RENDERER_DISPATCHED_METHODS` disjointness is a runtime test, not compile-time
  — a type-level partition would make drift a compile error. `apps/desktop/src/bridge/`.
- [med] `session.send` not reachable by sandboxed apps — the iframe runtime /
  postMessage↔IPC relay doesn't exist yet (only the built-in anonymizer path ships).
  `apps/desktop/src/apps/`.
- [med] NER model E2E only unit-verified — confirm model loads from `moxxy-app://`
  with zero network in a packaged/dev Electron run. `packages/desktop-host/src/apps/`.
- [med] transformers.js ↔ ORT wasm version coupling + installer↔HF asset-path
  coupling — re-verify packaged NER on any bump; keep the two path ends in lockstep.
  `packages/desktop-host/src/apps/registry.ts`.
- [low] No on-disk integrity check for installed app assets — add per-asset sha256
  when the model set stabilizes. `packages/desktop-host/src/apps/`.

## Anonymizer & NER

- [med] Polish NER recall unproven (cross-lingual transfer) — needs a real-Polish-doc
  eval harness or the `jiting/...hrl_onnx` fallback. `packages/anonymizer/`.
- [med] Vite emits a ~21 MB orphan ORT wasm under `dist/assets/` (internal
  `new URL(...)`) on every hot-update bundle — stop the emit via resolve alias /
  `assetsInclude`. `apps/desktop/electron.vite.config.ts`.
- [low] Crypto/secret checksums are structural-only (no crypto dep); no HIPAA
  Safe-Harbor profile; context window is a flat 48 chars. `packages/anonymizer/`.

## Desktop / attachments, settings, providers

- [med] Dropped attachments are invisible — round-trip a notice when
  `authorizeAttachments`/`buildAttachments` rejects/skips. `packages/desktop-host/src/ipc/`.
- [med, consistency] `provider.setEnabled` is fire-and-forget read-merge-write — two
  rapid cross-client toggles can lose one update. `packages/desktop-host/src/ipc/preferences.ts`.
- [low] Configure sheet can't edit a built-in provider's models array; `local`
  provider wizard prompts for a non-existent key (`auth.kind` should be `none`).
  `apps/desktop/src/settings/providers/`.

## Providers & model catalogs

- [med] Codex reasoning isn't round-tripped (`toResponsesInput` drops the reasoning
  block); Anthropic multi-block thinking collapses to one round-trip block. Only
  Anthropic round-trips fully. `packages/plugin-provider-*/`.
- [low] Hardcoded catalogs span 5+ providers and drift — a shared
  OpenAI-compatible-vendor catalog or `/v1/models`-backed refresh would self-update.
- [med] Advertised `contextWindow` values are trusted blindly by the proactive
  compactor (`estimatedTokens > 0.75 * contextWindow`, `compactor-summarize`). When
  a catalog overshoots the backend-enforced window, the proactive gate becomes
  unreachable and every long session degrades to the reactive compact-on-overflow
  retry (`turn-iterator.ts` `isContextOverflowError`). Fixed one instance (Codex
  gpt-5.5/gpt-5.4 1M→400k) but the failure mode is latent for any future catalog
  drift; consider calibrating the effective window from real provider `usage` /
  observed overflow rather than the static descriptor. Related: `resolveModelContext`
  (`packages/sdk/src/compactor-helpers.ts`) silently falls back to `models[0]` on an
  exact-id miss, so an unlisted/variant model id (e.g. a `[1m]` suffix) resolves the
  wrong window with no signal.

## Channels, relay & HTTP

- [low] Desktop channel catalog is now a MIRROR, not the only copy: each channel
  self-describes its config on `ChannelDef.config` (`fields`/`vaultKey`/
  `hasRequestUrl`/`runHint`), which the TUI `/channels` panel + `moxxy channels`
  read from the live registry. The desktop `channel-catalog.ts` still hand-copies
  it because the Electron main avoids booting plugin discovery; a
  `moxxy channels describe --json` (or a drift test asserting the desktop catalog
  matches each plugin's `def.config`) would remove the remaining duplication.
  `packages/desktop-host/src/channel-catalog.ts`.
- [low] Desktop-spawned channels are killed on app quit (a best-effort
  `process.once('exit')` SIGTERM in `channel-supervisor.ts`). The TUI/CLI surfaces
  now run channels DETACHED + status-file-discovered (`@moxxy/sdk/server`
  `channel-control.ts`: `spawn`/`liveChannelStatus`/`listLiveChannelStatuses`/
  `stop`), so they survive their launcher and re-adopt across restarts. The
  desktop supervisor could converge onto the same status-file model (discover +
  optionally adopt rather than always child-handle + kill-on-quit).
  `packages/desktop-host/src/channel-supervisor.ts`.
- [med] Relay is the single-instance sole remote path — no fallback; needs uptime
  monitoring + redeploy story (decide on an emergency escape hatch). `plugin-tunnel-proxy`.
- [med] Channel→core prod dependency — `plugin-cli`/`plugin-telegram` still import
  core helpers; hoist provider-neutral ones into the SDK. 
- [med] Shared HTTP-channel server base — `createServer`/`listen`/health/routing is
  replicated across `plugin-channel-http`/`-web`/`webhooks`/`ipc-server-ws`/
  `plugin-channel-slack` (the Slack ingest server is a 6th copy); an optional
  `HttpChannelServer` base would dedupe (larger refactor, lower payoff).
- [med, slack v1] Slack channel runs a SINGLE global `busy` single-flight — one
  turn at a time across ALL threads/channels (a 2nd @mention while busy gets a
  "still working" reply and is dropped). Per-thread concurrency (a turn per
  thread, the isolation seam supports it) is deferred. `packages/plugin-channel-slack/`.
- [med, slack v1, security] Slack channel is AUTONOMOUS — allow-list auto-approve
  with no human-in-the-loop (mirrors the HTTP channel). There is no Slack
  Interactivity button-approval flow; the operator must scope `allowedTools`
  narrowly at setup (every auto-approved call is logged). Revisit human-in-the-loop
  via Slack Interactivity (a 2nd Request URL) for v2. `packages/plugin-channel-slack/`.
- [low, slack v1] Slack replies stream as PLAIN TEXT via `chat.update` (no
  Block Kit / mrkdwn formatting, no message split for very long replies). A
  Telegram-style renderer + Block Kit would improve fidelity. `packages/plugin-channel-slack/`.
- [med, security] LAN pairing is cleartext `ws://` (RN/Expo can't trust a self-signed
  cert for a private IP); the secure phone path is the tunnel (`wss://`). Add optional
  `https.Server` + dev-build pinning only if direct-LAN encryption ever matters.
- [low] Web-preview path-prefix rewriting only matters if a non-base-path-aware HTTP
  app appears. `packages/plugin-channel-web/`.
- [low] Telegram rich-formatting is "simple yet powerful" but the powerful half is
  doc-only: the model isn't TOLD about `~~strike~~`/`||spoiler||`/`> [!type]` callouts,
  so it uses them only when a prompt/skill asks. The auto-wins (collapse the tool trace,
  render standard Markdown) need no model awareness. If we want the model to reach for
  collapsible callouts on its own, inject a one-line capability note into the session
  when the Telegram channel is active (no prompt-injection seam for channels exists yet).
  `packages/plugin-telegram/src/format.ts`.
- [low] The final-frame activity collapse (`<blockquote expandable>`) is always-on with
  a fixed 4-line threshold; if anyone wants it off, promote it to a per-chat `/details`
  toggle or a `TelegramChannelOptions` flag. `packages/plugin-telegram/src/render.ts`.

## Workflows

- [med] `awaitInput` barred inside a loop body (needs mid-iteration checkpointing);
  multi-pause stress-tested only to two pauses; concurrent paused runs of the same
  workflow surface as separate asks (UI ordering policy). `packages/plugin-workflows/`.
- [med] Resume relies on the child retained in the runner's in-memory registry — a
  runner restart between pause and resume loses it (checkpoint survives, continue
  fails cleanly); persist/rehydrate is future work. `packages/plugin-workflows/`, `core/subagents`.
- [med] Mobile workflow builder name fields are free-text — populate from
  `workflows.list` like desktop. Add a settings error-row retry if `settings.read`
  failures prove common. `apps/mobile/app/workflow-edit.tsx`.
- [med] Cross-session `afterWorkflow` can't route: the `workflow_completed` event is
  observed in-process by ONLY the runner that ran the parent, so a dependent pinned
  (`targetSessionId`) to a different session is skipped with a warning rather than
  run there. A shared completion queue (mirror the webhooks queue/drain from #333)
  would let any runner pick up its own-target dependents. `packages/cli/src/setup/wire-run-store.ts`.
- [low] No validation that a trigger's `targetSessionId` names a live session: a
  stale/mistyped id silently never fires (schedule owner-gates to an absent runner;
  fileChanged/afterWorkflow skip on every runner). The desktop picker surfaces a
  "(missing)" option, but `webhook_create`/`schedule_create`/workflow YAML can't
  validate without a live-desk registry. `packages/plugin-{webhooks,scheduler}`, `packages/cli`.

## Config / plugins manifest

- [note, RESOLVED 2026-06-25] The three overlapping config stores (flat
  `provider`/`mode`/`compactor` keys + package-keyed `plugins:` map +
  `~/.moxxy/preferences.json`) are unified into one category-grouped `plugins:`
  tree with a critical floor (Pillar 1). Provider/mode/model/disabled now persist
  through `@moxxy/config` writers; `preferences.json` is gone.
- [note, RESOLVED 2026-06-25] Pillar 2 done: the **EventStore** behind the event
  log is now a registry kind (`eventStore`) with a protected JSONL floor and an
  explicit-opt-in trust boundary, behaviour-identical (thin adapter over
  `SessionPersistence`). Pillar 3 (slim-core kernel + publish ~40 plugins +
  init-provisions + desktop seed-pack) remains planned but unstarted. Plan:
  `~/.claude/plans/i-think-we-need-zany-wirth.md`.
- [low, follow-up] EventStore: only the WRITE path routes through the active
  store (`attachSessionPersistence` → `getActive().open()`). The session-scoped
  READS (`restoreSessionEvents`/`readSessionEventPage` in build-session, runner
  session-handlers, mobile host) + cross-session management (`listSessionMetas`/
  `deleteSession`/`seedSessionLog`) still call the standalone JSONL fns. Identical
  while JSONL is the only impl; route them through `getActive()` (and add a
  default-store seam for the no-session listing) when a 2nd store lands.
- [low, dx] plugins-admin/runner/channels persist via raw-YAML `setIn` writers in
  `@moxxy/config/user-config.ts` — the typecheck can't catch a wrong path string;
  keep the round-trip tests honest and grep for `['plugins'` paths on changes.

## CLI / services

- [med, dx] `service install` units break under Electron-as-node (`nodeBin()` returns
  the Electron binary, no `ELECTRON_RUN_AS_NODE=1` → GUI ghost). Detect run-as-node,
  export the env var, prefer the Helper binary. `packages/cli/src/commands/service/common.ts`.
- [med] One-shot CLI commands (`-p`, `schedule run`, `doctor`, `login`, `init`) never
  `close()` — drain persistence before exit. `packages/cli/`.

## Mobile UI (low-priority polish)

- [med] Sending attachments while a turn is in flight is refused (inline payloads
  can't ride the path-based queue) — queue host-side if needed. `apps/mobile/`.
- [low] Misc: theme flip can lag memoized rows (need a `themeVersion` counter);
  `selectWorkspace`/`activeWorkspaceId` misnamed (they select a session); deprecated
  `SafeAreaView`/`expo-blur` hard dep; `toolGroupUi` dead fields; unused `LargeHeader`;
  header rename low-discoverability; composer-minimize overlay gesture not wired.
- [note] EAS build: `eas-build-post-install` runs `pnpm build` on the workspace
  closure; local repro needs wiping both `dist/` AND `*.tsbuildinfo`. `apps/mobile/eas.json`.

## Memory & embeddings

- [med] plugin-memory `EmbeddingIndex` stays separate from the SDK
  `CachedEmbeddingProvider` (different keying/bounding/persistence/eviction) — leave
  as-is; revisit only if `EmbeddingIndex` is reworked anyway. `packages/plugin-memory/`.
