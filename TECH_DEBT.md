# Tech debt — living journal

This is the repo's standing tech-debt ledger. **Treat it as a journal:** read it
before non-trivial work, retire at least one item per change, and log new debt the
moment you see it. See AGENTS.md → "Tech debt is a standing job".

**Pruned 2026-06-24** — the historical saga write-ups and all resolved/"Retired"
entries were compacted away; what remains below is the currently-OPEN backlog as a
scannable summary. Git history holds the full prior journal if you need it.

**Cleanup pass 2026-07-05** — targeted backlog sweep (parallel fixes over disjoint
subsystems). Retired: `moxxy channels rotate-token` CLI, compile-time `RENDERER_DISPATCHED_METHODS`
partition, `moxxy mobile` session-source stamp, Vite orphan-ORT-wasm emit, `local`-provider
key prompt, a channel-catalog drift guard, and mobile grab-bag cleanups (SafeAreaView, dead
`ToolGroupUi` fields, unused `LargeHeader`); plus two VERIFIED-already-fixed (`provider.setEnabled`
race now serialized by `configMutex`; one-shot commands drain via `closeSession()`) with
regression tests added. Refined (narrowed, still open): `resolveModelContext` now warns on the
`models[0]` fallback (calibration-from-usage still open); dropped-attachment notice, `FilesPane`
repo-root, built-in-provider model editing, and the remaining mobile-misc items carry precise
implementation paths. Full pre-PR gate green.

Severity tags: `[critical]`/`[high]`/`[med]`/`[low]`, `[note]` = standing practice
or recorded-on-purpose decision.

## Resolved ledger

- [high, modes, RESOLVED 2026-07-05] Goal mode killed its own runs and never let
  go: the iteration cap (150), a 4M token budget, and a stuck-loop FATAL abort
  (whose near-repeat heuristic trips on a legitimate edit→build→test cycle) all
  ended unattended runs mid-delivery, and the checkpoint injection budget never
  reset within a turn so the 4th *spread-out* idle nudge died with "checkpoint
  budget exhausted". Worse, `/goal` persisted `goal` as the config-wide mode
  default (future sessions BOOTED autonomous) and flipped session-wide
  yolo/auto-approve that nothing ever reverted. Fixed: goal runs are
  guardrail-free (terminals only: complete/abandon/idle-stall/abort/fatal; stuck
  trips now steer via `stuck.action: 'nudge'`), the injection budget is
  per idle-episode (`react-loop.ts`), and goal is `ModeDef.transient` — arms per
  objective, reverts to `ctx.previousModeName` on completion, refused as a
  boot/category default, and no channel flips session-wide approval anymore
  (the run's own scoped resolver auto-approves).
- [low, cli/security-dx, RESOLVED 2026-07-05] `moxxy channels rotate-token <name>` now wraps
  the SDK-only `rotateChannelToken` (SECURITY.md recommended rotation but no CLI exposed it):
  a reserved verb rotates `~/.moxxy/<name>-token` (the mobile channel's file convention) as a
  pure file op and prints a "clients must re-pair" notice.
  `packages/cli/src/commands/channels.ts`, `packages/cli/src/bin.ts`.
- [med, cli, RESOLVED 2026-07-05] One-shot commands (`-p`, `schedule run`, `doctor`, `login`,
  `init`) draining persistence before exit — VERIFIED already handled: the shared
  `closeSession()` (`flush()` → `settleWrites()` → `session.close()`) is awaited in each
  command's `finally`, ahead of `bin.ts`'s `process.exit`. Stale entry; kept as a
  regression-covered invariant. `packages/cli/src/setup/close-session.ts`.
- [med, desktop/config, RESOLVED 2026-07-05] `provider.setEnabled` "lost update" race —
  VERIFIED already fixed: the store moved off the stale `ipc/preferences.ts` pointer into
  `@moxxy/config`, whose read-modify-write runs inside a module-level `configMutex`; added a
  two-concurrent-toggles no-lost-update regression test.
  `packages/config/src/user-config.ts`, `packages/config/src/user-config.test.ts`.
- [med, apps, RESOLVED 2026-07-05] `RENDERER_DISPATCHED_METHODS` disjointness/exhaustiveness vs
  the host `BridgeServices` map was runtime-test-only (drift compiled fine). Now compile-enforced:
  `BridgeMethod = RendererDispatchedMethod | HostDispatchedMethod`, the renderer Set built from a
  `Record<RendererDispatchedMethod, true>` table, `BridgeServices` a mapped type keyed by
  `HostDispatchedMethod`, plus two equality guards (exhaustive over `keyof BridgeMethods` +
  disjoint). Member lists unchanged; runtime tests kept as belt-and-suspenders.
  `packages/desktop-app-sdk/src/bridge.ts`, `packages/desktop-app-sdk/src/index.ts`,
  `packages/desktop-host/src/apps/bridge-host.ts`.
- [low, mobile, RESOLVED 2026-07-05] Standalone `moxxy mobile` left `MOXXY_SESSION_SOURCE` unset,
  so the runner's env heuristic stamped the empty pre-first-prompt session `'tui'` and dropped it
  from the mobile list until its first prompt. Fixed by declaring `sessionSource:'mobile'` on
  `mobileChannelDef` and making `applyDedicatedRunnerEnv` stamp a DECLARED source even for
  non-dedicated channels (caller-pinned env still wins).
  `packages/plugin-channel-mobile/src/index.ts`,
  `packages/cli/src/commands/start-registered-channel.ts`.
- [low, mobile, RESOLVED 2026-07-05] Mobile UI grab-bag: migrated `QrScannerSheet`'s deprecated
  RN `SafeAreaView` to `react-native-safe-area-context`; removed dead `ToolGroupUi.accent`/`tint`
  fields; deleted the unused `LargeHeader` component. `apps/mobile/src/components/QrScannerSheet.tsx`,
  `apps/mobile/src/toolGroupUi.ts`, `apps/mobile/src/ui/kit.tsx`.
- [med, desktop/vite-build, RESOLVED 2026-07-05] transformers.js's ORT glue
  `new URL('…jsep.wasm', import.meta.url)` made Vite emit a ~21 MB ORPHAN wasm into `dist/assets/`
  on every bundle (dead path — the NER worker sets `wasmPaths=/ort/`, so `locateFile` always wins).
  Added an `ortWasmDropOrphan()` renderer plugin deleting the hashed `assets/` orphan in
  `generateBundle`; the real `dist/ort/…jsep.wasm` copy (`writeBundle`, unhashed name, outside the
  Rollup bundle) is untouched — verified in an isolated repro. `apps/desktop/electron.vite.config.ts`.
- [low, desktop/local-provider, RESOLVED 2026-07-05] The desktop Configure sheet prompted for a
  non-existent API key on the keyless `local` provider (core reports its placeholder-key authKind
  as `api-key`). Added `providerNeedsNoKey()` (keyed off the canonical `local` slug) to show a
  "no key needed" note instead of a key input. `apps/desktop/src/settings/ProvidersTab.tsx`.
- [low, desktop-host/channel-catalog, RESOLVED 2026-07-05] The hand-mirrored `channel-catalog.ts`
  had no test catching drift from the source of truth. Added a drift guard importing each channel
  plugin's `ChannelDef` directly and asserting vault keys / required / secret-type / `hasWebhookUrl`
  match (keyed by `vaultKey`) — silent drift now fails a test. (Removing the duplication via
  `channels describe --json` remains a separate follow-up.)
  `packages/desktop-host/src/channel-catalog.test.ts`.
- [med, modes, RESOLVED 2026-07-05] Every ReAct-shaped mode duplicated ~250 lines
  of loop plumbing — `mode-default`, `mode-goal`, and the collab agent loop each
  carried a divergent copy of retry back-off / reactive compaction / stuck
  detection / abort handling (collab's had NO back-off, so a sustained 429
  busy-looped it; default retried un-compactable overflows 6× before dying where
  goal failed fast). Extracted into `runReactLoop`
  (`packages/sdk/src/mode/react-loop.ts`) with per-mode policy hooks + a turn-end
  checkpoint gate (`TurnCheckpoint`); the three modes are now thin policy layers
  and the hardened semantics are unified (goal's overflow rule everywhere,
  bounded back-off everywhere).
- [med, security, RESOLVED 2026-07-03] `security.perPlugin` isolator overrides were
  a dormant config option: real sessions wired `buildSecurityPlugin` with
  `resolvePluginForTool: null` (plugin-level routing disabled), so the documented
  `perPlugin` schema key never routed anything. The CLI now resolves tool → owning
  plugin from the plugin host's loaded records (`PluginHost.ownerOfTool`, exposed on
  the SDK `PluginHostHandle` as optional so thin clients may omit it), which also
  powers the new `moxxy security audit --package <name>` / `--by-package` views and
  install_plugin's combined-capability report. `packages/cli/src/setup/builtins.ts`,
  `packages/core/src/plugins/host.ts`, `packages/plugin-security/src/index.ts`.
- [med, dx, RESOLVED 2026-07-03] `service install` units no longer break under
  Electron-as-node: `installAndStartService` detects `process.versions.electron`
  and exports `ELECTRON_RUN_AS_NODE=1` into the unit env, so a desktop-spawned
  install can't boot the GUI as a ghost daemon. The "prefer the Helper binary"
  half was deliberately skipped — the env var fully fixes launch semantics and
  the Helper path is packaging-layout-dependent.
  `packages/cli/src/commands/service/index.ts`.
- [low, sessions, RESOLVED 2026-07-03] `SessionSource` literals were hand-listed in
  one runtime spot (`sessionSource()`'s validator in
  `packages/cli/src/setup/persistence.ts`) — adding the Discord channel's
  `'discord'` source hit exactly the two-spot update this entry warned about, so
  the list is now a runtime constant: `SESSION_SOURCES` in `@moxxy/sdk`
  event-store.ts, with the `SessionSource` type DERIVED from it
  (`(typeof SESSION_SOURCES)[number]`) and the CLI guard doing an `includes()`
  against the same array. New sources are now a one-line change that can't be
  silently dropped by a stale validator.
- [dormant, browser, RESOLVED 2026-07-03] CDP screencast push path (`startScreencast`/
  `stopScreencast` sidecar handlers) — the entry was stale: the handlers were already
  deleted in the PR #212 quality sweep; only screenshot-polling remains (rationale in
  `packages/plugin-browser/src/browser-surface.ts`). A regression guard pins the former
  methods to `unknown method` (`packages/plugin-browser/src/sidecar/dispatch.test.ts`).
- [low, tools, RESOLVED 2026-07-03] `resolveSafe` deprecated alias for `resolvePath`
  removed (no callers remained). `packages/tools-builtin/src/util.ts`.
- [med, mobile, RESOLVED 2026-07-03] `apps/mobile` was the only package in the
  repo type-checking without `noUncheckedIndexedAccess` + `verbatimModuleSyntax`
  (it extends `expo/tsconfig.base`, not the moxxy base, so it silently missed the
  strict baseline). Both flags are now set explicitly in its tsconfig and the
  surfaced errors fixed. Gotcha: `expo-file-system` ships raw TS source
  (`"main": "src/index.ts"`) and the `/legacy` subpath has no `types` mapping, so
  tsc type-checked Expo's own source under the new flag — resolved by migrating
  the app's three read call sites off `expo-file-system/legacy` onto the modern
  SDK 54 `File` API (`new File(uri).base64()/.text()`), whose root import
  resolves through the shipped `.d.ts` where `skipLibCheck` applies.
  `apps/mobile/tsconfig.json`, `apps/mobile/src/pairingUrl.ts`,
  `apps/mobile/src/styles/tokens.ts`, `apps/mobile/src/hooks/useAttachments.ts`,
  `apps/mobile/src/hooks/useVoiceRecorder.ts`.
- [low, dry, RESOLVED 2026-07-03] Ad-hoc retry/backoff sleeps consolidated onto the
  sdk's shared `sleepWithAbort` (now surfaced directly on the barrel next to
  `nextBackoffMs`, not buried in the mode-helpers block): the runner's
  initial-connect retry + SIGTERM grace waits and the desktop supervisor's restart
  wait (`forceRetry` now aborts the sleep) / socket poll / kill grace. Schedules
  deliberately unchanged (linear connect retry, constant supervisor wait).
  `packages/runner/src/remote-session.ts`,
  `packages/desktop-host/src/runner-supervisor.ts`, `packages/sdk/src/index.ts`.
- [med, sessions, RESOLVED 2026-07-03] Event-log READS no longer cast blindly:
  all three JSONL parse sites (`restoreEvents`, `readEventPage`, index
  hydration) route through a shallow structural guard (`isMoxxyEventShape`)
  that skips wrong-shape-but-valid-JSON lines with the exact corrupt-line
  semantics (never throw mid-replay; restore counts them as
  `invalidShapeLines` and repairs the file). This closes the read-side leak in
  the EventStore trust boundary (Pillar 2 note below): a junk line can no
  longer drive replay (a `compaction` line missing `replacedRange` used to
  throw inside `projectMessagesFromLog`'s unconditional dereference). The
  guard is allocation-free per line, exhaustively typed against the
  `MoxxyEvent` union (variant drift fails the build), and deliberately keeps
  unknown NEWER event types with a valid envelope so a floor rollback can't
  rewrite away a newer version's history.
  `packages/core/src/sessions/event-shape.ts`.
- [low, focus, RESOLVED 2026-07-02] Focus Mode mini-chat no longer carries a
  separate text-only composer path: pasted screenshots now reuse the desktop
  attachment save/preview/send pipeline, zoomed image previews can be drag-panned,
  and the mini-text panel remembers the user's native-resized size through local prefs.
  `apps/desktop/src/focus/`, `apps/desktop/src/chat/image-preview/ImagePreviewModal.tsx`,
  `apps/desktop/src/chat/composer/useComposerAttachments.ts`,
  `packages/desktop-ipc-contract/src/{prefs,validation}.ts`,
  `packages/desktop-host/src/{prefs,focus-window}.ts`.
- [high, collab, RESOLVED 2026-07-01] Collaboration is now a SEPARATE feature on
  BOTH surfaces: the coordinator runs on its own dedicated `moxxy collab` runner
  (own Session + socket), never inside a chat session — no mode-flip, no team
  activity in a chat's thread. Desktop: the Collaborate panel supervises it
  (`CollabSupervisor`) over dedicated `collab.*` IPC + `collab.event`/`collab.approval`
  (a private `useCollab` hook, not `useChat`). TUI: `/collab` re-points the terminal
  onto the coordinator's own session via the in-place session switch (auto-submits
  the goal via `initialPrompt`; bare `/collab` attaches-to-view), reusing the whole
  SessionView (transcript, `CollabScopeView`, approval, step-in). `packages/cli/src/commands/{collab,run-tui}.ts`,
  `packages/desktop-host/src/collab-supervisor.ts`,
  `packages/plugin-cli/src/session/{run-slash,BootShell,SessionView,sessions-picker}.*`,
  `packages/mode-collaborative/src/{constants,collab-store,collab-lock}.ts`,
  `apps/desktop/src/collaborate/{useCollab.ts,CollaboratePanel.tsx}`.
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
- **Goal runs have no spend ceiling — on purpose (2026-07-05).** Guardrails
  (iteration cap, token budget, stuck-abort) killed real deliveries, so goal mode
  removed them by explicit product decision; the backstops are the always-visible
  GOAL badge, Esc/abort, the idle-stall soft-terminal, and stuck-NUDGE steering.
  If runaway-spend reports appear, add an opt-in `context.goal.budget` config
  (off by default) rather than reintroducing silent hard stops.

## Sessions / workspace

- [low, scale] `desks.list` derives in O(N) `stat`s (one `readdir` + a `stat` per
  session file; parses only changed files via the mtime cache). Fine for hundreds–
  low thousands; at very large N a registry-level derived-cache invalidated by the
  sessions-dir watcher would make it O(1). `packages/core/src/sessions/persistence.ts`.
- [low, scale] `desks.changed` ships the full desk list (O(N) payload); a delta
  event (changed desk/session only) would cut cross-device payload to O(1). The
  projection-diff already suppresses per-event churn. `packages/desktop-host/src/sessions-watcher.ts`.
- [note] Stress-test multi-session with a desk's SECOND (UUID) session — the first
  session has id === desk id, which masks pool-key regressions. `packages/desktop-host`.
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

- [note, mobile, OTA] EAS Update runtime version uses the `appVersion` policy
  (not `fingerprint`) because iOS native is COMMITTED (`apps/mobile/ios/` holds
  custom Live Activity Swift, so no full CNG). The consequence: the iOS runtime
  version + updates URL live STATICALLY in `ios/.../Supporting/Expo.plist`
  (`EXUpdatesRuntimeVersion=1.0.0`, `EXUpdatesEnabled`, `EXUpdatesURL`), so when
  you bump `version` in `app.json` for a native release you MUST also update that
  plist (or re-run `expo prebuild -p ios`) or iOS builds silently stop matching
  their OTA channel. Android is CNG and reconfigured by EAS automatically, so it
  doesn't have this hazard. Recorded on purpose; revisit if the committed iOS
  project is ever replaced by prebuild-on-build.
  `apps/mobile/app.json`, `apps/mobile/app.config.ts`,
  `apps/mobile/ios/MoxxyMobileGateway/Supporting/Expo.plist`.

## Runner / protocol & architecture

- [note, dry] Three inline backoff/retry implementations remain ON PURPOSE and must
  not be "deduped" onto `@moxxy/sdk`'s `sleepWithAbort`/`nextBackoffMs`:
  `client-transport-ws/src/json-rpc-client.ts` (cancellable-timer reconnect; the
  sdk barrel statically reaches `node:fs/promises`, which breaks its Metro/RN
  bundle — rationale commented at the site), `plugin-channel-web/src/frontend/
  socket.ts` (browser bundle), `plugin-provider-claude-code/src/login.ts`
  (bespoke OAuth retry). Revisit only if the sdk grows a dependency-free
  browser-safe subpath (like `@moxxy/sdk/tool-display`).
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
  push a transient/sub-full column count to a PTY-backed surface. Guarded renderer-side
  (120px-width floor + rAF-coalesced fit in `apps/desktop/src/shell/surfaces/TerminalPane.tsx`)
  and validated/clamped in `packages/plugin-terminal/src/{terminal,pty}.ts`; keep new
  viewers behind the same guard.
- [dormant] Piped-shell fallback is intentionally non-interactive — needs CR→LF +
  local echo if a no-prebuild platform ever needs it (the degraded state IS surfaced
  to the viewer). `packages/plugin-terminal/src/pty.ts`.
- [low] Files pane polls IPC instead of streaming via the Surface protocol — promote
  to a real Surface if a third live pane appears. `apps/desktop/src/shell/surfaces/`.
- [low] "Add to agent" on a git-changed file assumes cwd === repo root: `git status`
  paths are repo-root-relative, but `FilesPane` builds `absPath = cwd + relPath`, wrong
  when the session cwd is a repo subdir (the same mismatch hits the diff viewer's
  `confineDiffPath`). No repo-root is exposed to the renderer; the fix needs a new
  `git.root` IPC (`ipc/git.ts` + contract). `apps/desktop/src/shell/surfaces/FilesPane.tsx`.
- [low] Terminal tool completion is sentinel-heuristic; a structured exec channel
  would be cleaner. `packages/plugin-terminal/`.

## Desktop / apps & send-to-chat

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
- [low] Crypto/secret checksums are structural-only (no crypto dep); no HIPAA
  Safe-Harbor profile; context window is a flat 48 chars. `packages/anonymizer/`.

## Desktop / attachments, settings, providers

- [med] Dropped attachments are invisible — two silent skip sites only `console.warn`:
  `authorizeAttachments` (`ipc/session.ts`, sync, drops unauthorized-provenance paths; its
  `dropped[]` is already available) and `buildAttachments` (`attachments.ts`, skips
  oversized/binary/unextractable files) which runs ASYNC inside `session-driver.ts`'s
  fire-and-forget pump AFTER the IPC `{turnId}` already returned. A user notice needs a
  contract transport (a `droppedAttachments?` field on `RunTurnResult` and/or a
  `skippedAttachments?` on `runner.turn.complete`), emission from `session-driver.ts`, and
  renderer display — no generic notice channel exists to reuse (only `error{kind:'fatal'}`
  renders, which would read as a turn failure).
  `packages/desktop-host/src/{ipc/session.ts,attachments.ts,attachment-authz.ts}`.
- [low] Configure sheet can't edit a built-in provider's models array — a genuine
  feature, not a bug: provider-admin (`plugin-provider-admin`) intentionally throws
  `CONFIG_INVALID` on `configure()` of a built-in (they are code, not stored config),
  so exposing model-array editing needs new runner-side persistence for built-in
  overrides. (The sibling `local`-wizard non-existent-key prompt is FIXED — see ledger.)
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
  retry (`react-loop.ts` `isContextOverflowError`). Fixed one instance (Codex
  gpt-5.5/gpt-5.4 1M→400k) but the failure mode is latent for any future catalog
  drift; consider calibrating the effective window from real provider `usage` /
  observed overflow rather than the static descriptor. Related: `resolveModelContext`
  (`packages/sdk/src/compactor-helpers.ts`) still falls back to `models[0]` on an
  exact-id miss (an unlisted/variant id like a `[1m]` suffix resolves the wrong
  window), but the fallback is no longer SILENT — it emits a one-shot `console.warn`
  deduped per (provider, requested id, fallback id). Remaining: calibrate the
  *effective* window from observed usage/overflow rather than the static descriptor.

## Channels, relay & HTTP

- [low] Origin-bearing `user_prompt` events (webhook/schedule/workflow triggers
  and now the ReAct loop's checkpoint-gate injections, `origin.kind:
  'checkpoint'`) render as a compact chip on desktop (`apps/desktop/…/
  TriggerBlock.tsx`) but the TUI has no origin-aware rendering — trigger
  payloads and mid-turn checkpoint feedback show as full user-style bubbles.
  `packages/plugin-channel-tui`.
- [low] Discord channel pairing is terminal-only: the DM code flow (bot DMs a
  one-time code → operator pastes it into `moxxy discord pair`) has no GUI
  completion path, so the desktop Channels panel can start the bot dedicated
  (window armed, codes issued) but the paste must happen in a terminal, and the
  already-running dedicated runner only reloads the authorized principal at
  start — pairing from the desktop means run `moxxy discord pair`, then restart
  the channel. A `channels.confirmPairingCode` control-surface hook (status-file
  or IPC) would close both gaps. `packages/plugin-channel-discord`.
- [low] Desktop channel catalog is a MIRROR: each channel self-describes its config on
  `ChannelDef.config` (`fields`/`vaultKey`/`hasRequestUrl`/`runHint`), which the TUI
  `/channels` panel + `moxxy channels` read from the live registry, but the desktop
  `channel-catalog.ts` hand-copies it (the Electron main avoids booting plugin discovery).
  A drift test now guards silent divergence (see ledger); the remaining follow-up is
  REMOVING the duplication via a `moxxy channels describe --json` the desktop consumes.
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
- [med, PARTIALLY DONE 2026-07-03] Shared HTTP-channel server base —
  `createServer`/`listen`/health/routing is replicated across
  `plugin-channel-http`/`-web`/`webhooks`/`ipc-server-ws`. The Slack copy is
  RETIRED: `@moxxy/channel-kit` now owns the inbound-webhook scaffold
  (`IngestHttpServer`: routing/health/size-capped raw body/verify gate/500
  catch-all + `DeliveryDedupeCache`) and Slack's ingest is a thin pipeline on
  it. Migrating the remaining four is still the larger, lower-payoff refactor.
- [note, whatsapp, security] `@moxxy/plugin-channel-whatsapp` is the first channel
  on an UNOFFICIAL client (Baileys / WhatsApp Web protocol): automating an account
  violates WhatsApp's ToS and the number can be permanently BANNED. Two standing
  tradeoffs recorded on purpose: (1) the rotating Baileys auth-state (signal
  sessions/pre-keys/creds) is stored UNENCRYPTED at rest under
  `~/.moxxy/whatsapp-auth` (dir 0700, files 0600) — the vault is the wrong home for
  a high-write rotating key store, so it isn't used; anyone with file access to the
  moxxy home can hijack the linked session. The `WhatsAppAuthStorage` interface
  exists so an encrypted backend can be swapped in later without touching the
  channel. (2) permission prompts are PLAIN-TEXT numbered replies (Baileys has no
  reliable multi-device interactive buttons), captured as the owner's next short
  message. Follow-ups: encrypted auth-state backend; per-chat concurrency (single
  global `busy` today, like Slack v1); richer formatting.
  `packages/plugin-channel-whatsapp/`.
- [note, channels] Channel scaffolding shared by telegram+slack+signal+whatsapp
  now lives in `@moxxy/channel-kit` (FramePump, TurnCoordinator + turnId-filtered
  turn helpers, host-code + TOFU pairing machines, `resolveSecret`, audited
  allow-list resolver, ingest scaffold, PlainTurnRenderer). Signal + WhatsApp
  (2026-07-03) validated the thin-adapter claim: both consume
  TurnCoordinator/driveTurn/PlainTurnRenderer/resolveSecret (Signal also
  createAuditedAllowListResolver, WhatsApp also FramePump) and add only their
  messenger's quirks. New channels (Discord) should be thin adapters over it —
  messenger quirks (formatting, transport error mapping, signature schemes,
  pairing wording) stay in each plugin.
  Deliberately NOT extracted (single-implementation or channel-specific):
  Telegram's rich TurnRenderer/HTML pipeline + inline-keyboard
  permission/approval prompts + grammy dispatch, Slack's HMAC verify + zod
  envelope schema + Web-API client, both setup wizards/pair flows.
  `packages/channel-kit/`.
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
- [med, signal v1, security] Signal channel is AUTONOMOUS like Slack —
  allow-list auto-approve, no human-in-the-loop (every auto-approved call is
  logged). Signal has no server-side button UI, but a reply-keyword approval
  flow ("reply YES/NO to approve") over the deferred resolver is feasible for
  v2. Also v1 gates on a static sender allow-list edited only via the vault
  key / `--allowedSenders`; an `allow <number>` subcommand would help.
  `packages/plugin-channel-signal/`.
- [med, signal v1] Signal channel is direct-message only (group envelopes are
  dropped) and runs the same single global `busy` single-flight as Slack v1.
  Group support needs a group-id trust story + `groupId` send targets.
  `packages/plugin-channel-signal/`.
- [low, signal v1] Replies are plain-text buffered chunk sends (justified in
  `channel/chunker.ts` — Signal edits re-deliver the full body E2E per frame),
  so there is no live-updating draft; liveness is the typing indicator only.
  If signal-cli ever grows a cheap draft/edit path, revisit FramePump here.
  Daemon crash recovery is exit-fatal (supervisor restart), not in-process
  respawn. `packages/plugin-channel-signal/`.
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
  `SessionPersistence`). Plan: `~/.claude/plans/i-think-we-need-zany-wirth.md`.
  2026-07-03: the read-side gap this boundary still leaked (JSONL lines cast to
  `MoxxyEvent` instead of validated) is closed — see the `isMoxxyEventShape`
  entry in the resolved ledger.
- [note, updated 2026-07-03] Pillar 3 is HALF done, not unstarted: #363/#364
  shipped the shared `provision()` engine + `moxxy provision`, reworked `init`
  (catalog + `ensureProvider` npm-installs on demand), and unbundled the 6
  API-key providers (published, fixed changeset group). Remaining, tracked in
  plan `~/.claude/plans/cheerful-booping-nebula.md`: unbundle the ~20 still-private
  discovery-loadable plugins in batches, pin on-demand installs to the CLI
  version (currently `latest`), desktop seed pack, TUI install/connect
  affordances.
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

- [med, channels, security] The serve.ts "first interactive channel wins the shared
  permission resolver" note is aspirational, not real: the `resolverSetByChannel`
  gate only exists in the `serve --all` startup loop (`serve.ts` `startChannel`),
  while every pairing/attach path calls `session.setPermissionResolver`
  UNCONDITIONALLY (`start-registered-channel.ts` both attach modes, each channel's
  `pair-flow.ts`, mobile `single-session-host.ts`) — so in practice the resolver is
  last-writer-wins: pair Discord then WhatsApp and Discord silently stops receiving
  permission prompts (they route to the most recent channel's surface). One Session
  has exactly one resolver slot (`core/src/session.ts setPermissionResolver`).
  `moxxy onboard` sidesteps it (single channel pick, pair-then-return), but a real
  fix needs either per-source resolver routing on the Session or a documented
  broker. Surfaced 2026-07-03 while building onboard.

## Mobile UI (low-priority polish)

- [med] Sending attachments while a turn is in flight is refused (inline payloads
  can't ride the path-based queue) — queue host-side if needed. `apps/mobile/`.
- [low] Misc (remaining after 2026-07-05 cleanup): `selectWorkspace`/`activeWorkspaceId`
  misnamed (they select a session) — BLOCKED, it's a shared
  `client-core`/`desktop-ipc-contract` wire symbol, not mobile-local; `expo-blur` is a hard
  dep but `BlurView` is actually used (not removable — revisit only if the glass surface is
  dropped); theme flip could be reworked to a `themeVersion`-in-memo-deps model (today an
  existing `key={scheme}` FlatList remount already re-resolves rows, so low value); header
  rename low-discoverability; composer-minimize overlay gesture not wired. (SafeAreaView
  migration, `toolGroupUi` dead fields, and the unused `LargeHeader` are FIXED — see ledger.)
- [note] EAS build: `eas-build-post-install` runs `pnpm build` on the workspace
  closure; local repro needs wiping both `dist/` AND `*.tsbuildinfo`. `apps/mobile/eas.json`.

## Docs site

- [note, logged 2026-07-03] `apps/docs/src/content/docs/why-moxxy.md` carries
  dated competitor claims (star counts, channel counts, security-posture quotes
  from OpenClaw/pi/Hermes READMEs, "as of July 2026"). These go stale; re-verify
  against the linked sources roughly quarterly or when a comparison looks off.

## Memory & embeddings

- [med] plugin-memory `EmbeddingIndex` stays separate from the SDK
  `CachedEmbeddingProvider` (different keying/bounding/persistence/eviction) — leave
  as-is; revisit only if `EmbeddingIndex` is reworked anyway. `packages/plugin-memory/`.
