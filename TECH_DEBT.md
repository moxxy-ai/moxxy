# Tech debt — living journal

This file is the repo's standing tech-debt ledger. **Treat it as a journal, not an
archive:** every code change should retire at least one entry here, bigger pieces of
work should re-audit the area they touch and refresh the relevant items, and new debt
you introduce or notice gets written down the moment you see it. See AGENTS.md →
"Tech debt is a standing job" for the working rule.

**Origin:** the May 2026 plugin-by-plugin code-quality audit (38-agent analysis →
18-agent fix sweep). The safe high-value subset shipped on `refactor/code-quality-sweep`
(merged, PR #6). What remains below is what was deliberately deferred, what was blocked
as unsafe to do mechanically, and debt accrued since.

**Last refreshed:** 2026-06-09 (second pass) — **journal repair + audit intake.** PRs #113
and #115 rebuilt this file from a branch cut before #107/#108 merged, silently resurrecting
two entries those PRs had retired (P1 #2's growth defect, P2 #6 mode-loop scaffolding) and
deleting the #108 resolved-ledger record. Both retirements are now restored (verified
against the code at `f13b007`: `chat-log.ts` id-dedup in place, `sdk/src/tool-dispatch.ts`
composed by both modes). Lesson recorded: **rebase TECH_DEBT.md against main before
editing it on a long-lived branch — it is the one file where a stale merge silently lies.**
The same pass folded in the 2026-06-09 full main-branch audit (38 agents, adversarially
verified) — see the "audit intake" section below; full report:
`.claude/audits/main-audit-2026-06-09.md`.

Earlier 2026-06-09 — the "update flows" work (CLI `moxxy update` + TUI version
banner + desktop self-update observability) **retired the self-update typed-error sub-bullet
of P1 #5** (re-scoped as won't-fix-by-design — see it) and closed the long-standing
*silent* desktop fall-back-to-the-floor by adding a persisted boot-decision log; the one
remaining piece (confirming the runtime root cause on a packaged build) is logged as #9.

2026-06-08 — re-verified every open item against `HEAD` and folded
in findings from the desktop-resume / claude-code-provider / plugins-admin work that
landed after the original audit. All prior "✅ DONE" items were re-checked and confirmed
still in place (no regressions); they're collapsed into the ledger at the bottom. The same
pass also **retired the plugins-admin CLI install-hardening + dedup items** (former P2
#7/#8 — see the ledger) as the first chip-away under the new journal rule.

---

## 2026-06-17 — Skills gallery reimplements the shared settings `SearchBox`

- **`SkillGallery` hand-rolls its own search input** (the `display:flex` row with
  the magnifier `Icon` + `<input type="search">` in `apps/desktop/src/settings/skills/SkillGallery.tsx`)
  instead of using the `SearchBox` primitive already exported from
  `apps/desktop/src/settings/settings-primitives.tsx` for the MCP/Vault/Providers
  tabs. The markup is a near-verbatim copy, so styling drift between the Skills
  search and the other tabs' search is a when-not-if. Noticed while aligning the
  Skills empty state to the shared `EmptyState` (this change retired the bespoke
  `EmptyHero` logo). **Fix:** swap the inline block for `<SearchBox value={query}
  onChange={setQuery} placeholder="Search skills…" />` and delete the duplicate.
  Left out of this PR to keep it a pure empty-state alignment.

## 2026-06-17 — desktop native build (node-gyp) is brittle against runner-image churn

- **Partly retired — node-gyp modernised, Python pin dropped, one CI pin remains.**
  `node-gyp@9.4.1` was too old for the current GitHub runner images (electron-builder →
  `@electron/rebuild` → node-gyp rebuilds `node-pty` against Electron's ABI). A root
  `pnpm.overrides` now pins **node-gyp `^11.5.0`** (lockfile regenerated); 11.x is
  Python-3.12-native, so the **Python 3.11 pin from #200 is removed** from `release.yml`
  on every leg. `@electron/rebuild@3.6.1` (which declares node-gyp `^9.0.0`) drives the
  overridden 11.x fine.
- **Residual (1): the Windows leg is still pinned to `windows-2022`.** Even node-gyp 11
  can't detect Visual Studio 2026 on the `windows-2025-vs2026` image (it reads VS's 18.x
  version as `undefined`); no released node-gyp handles it yet (nodejs/node-gyp#3282 /
  #3250). `windows-2022` (VS2022) is the required mitigation until node-gyp ships VS2026
  support — then this can return to `windows-latest`.
- **Residual (2): node-gyp can't advance past 11.x without raising the repo's Node floor.**
  node-gyp 12 needs Node `>=20.17`, node-gyp 13 needs `>=22.22.2`; the repo declares
  `engines.node: ">=20.10.0"` and node-pty compiles via node-gyp at install time, so a
  newer node-gyp would break `pnpm install` on supported Node versions. Revisit if/when the
  minimum Node bumps (e.g. when dropping Node 20).

## 2026-06-17 — desktop self-update URL broke on product-name spaces (mac + win)

- **Retired: `app.updateShell` (Tier-2) 404'd on macOS and Windows because the updater
  feed referenced an asset name GitHub had renamed.** `productName` is `"MoxxyAI
  Workspaces"` (a space); mac/win had no explicit `artifactName`, so the default templates
  produced spaced names. electron-builder wrote the space as a hyphen into
  `latest-mac.yml` / `latest.yml` (`MoxxyAI-Workspaces-…`), while GitHub rewrote the space
  in the uploaded asset to a dot (`MoxxyAI.Workspaces-…`) — so electron-updater built a
  download URL that didn't exist (e.g.
  `…/desktop-v0.8.0/MoxxyAI-Workspaces-0.8.0-arm64-mac.zip`). Linux was unaffected because
  it already had a space-free `artifactName`. Fixed by giving mac
  (`moxxy-desktop-${version}-${arch}.${ext}`) and win
  (`moxxy-desktop-${version}-setup.${ext}`) the same space-free convention, so the feed
  path, the on-disk file, and the GitHub asset name all match.
- **Residual: already-published releases (≤ desktop-v0.8.0) keep the broken asset names**
  — this fix only corrects releases built after it, so 0.7.x→0.8.0 in-app updates stay
  broken. Repairing an old release means renaming its assets to match its own `latest*.yml`
  (or re-uploading), a manual GitHub op done outside this change.

## 2026-06-17 — desktop OAuth provider sign-in (claude-code) + de-hardcoded auth kind

- **Retired: Settings → Providers showed a dead "run `moxxy login <provider>` in a
  terminal" comment for OAuth providers.** It now drives a real sign-in: a shared
  `OAuthSignIn` component spawns `moxxy login <provider>` in the host and relays the
  flow, opening the browser and collecting any pasted value. Onboarding's `ProviderStep`
  was migrated onto the same component, so both surfaces behave identically.
- **Retired the `onboarding.providerAuthKind` hardcode** (`OAUTH_PROVIDERS = new
  Set(['openai-codex'])`, which mis-classified `claude-code` as api-key and showed it a
  key field). It now reads the runner's own registry metadata
  (`getInfo().providers[].authKind`) — the source of truth that already feeds Settings —
  and only falls back to a static set (now both OAuth providers) when the runner isn't
  reachable yet. One fewer place a new OAuth provider must be registered by hand.
- **Removed dead code:** `installer.ts#runProviderLogin` and the
  `onboarding.runProviderLogin` IPC command (+ its validation schema), superseded by the
  generic `provider.login.start/answer/cancel` commands.
- **New seam (not debt, noted for the next reader):** out-of-band providers like
  `claude-code` ask the user to paste a token / `code#state`, which a GUI host can't do
  over a clack TTY. The CLI's `moxxy login --stdin-prompts` now relays each `ctx.prompt`
  as a NUL-bracketed marker on stdout (parsed by `@moxxy/sdk`'s
  `createLoginStreamScanner`) and reads answers as stdin lines — so the desktop drives the
  paste flow without re-implementing the OAuth dance. Loopback providers (openai-codex)
  emit no markers and are unaffected.

## 2026-06-17 — agentic surfaces (shared terminal · in-window browser · files+diff)

New `Surface` block (SDK `defineSurface` + `SurfaceRegistry`/`SurfaceHost` in
core), runner protocol **v8** (`surface.*` methods + `surface.data` notification),
desktop IPC relay, `@moxxy/plugin-terminal` (shared PTY) and a `browser` surface
on `@moxxy/plugin-browser`, plus the repurposed context dropdown + resizable
rail + git "Files changed" diff pane. Reviewed this journal before/while doing
the work; the change is purely additive infrastructure, so it retires no existing
item — the debt it *creates* is logged here on sight:

- **Browser surface uses a real CDP screencast** (`Page.startScreencast` →
  `Page.screencastFrame`, JPEG) pushed over a new unsolicited sidecar event
  channel — not polling. Chromium-only; falls back to no frames (the
  `browser_session` tool is unaffected) if CDP is unavailable. Files:
  `packages/plugin-browser/src/{browser-surface.ts,sidecar/dispatch.ts}`.
- **node-pty ships as an optional native dep of the CLI** (`@moxxy/cli`
  optionalDependencies + root `pnpm.onlyBuiltDependencies`), so the terminal uses
  a real PTY when the binary builds (it's N-API, ABI-stable like
  `@napi-rs/keyring`, so the desktop's `pnpm deploy --prod` bundle works without
  electron-rebuild). Falls back to the dependency-free piped shell when absent.
  **Remaining:** verify the real PTY in a *packaged* desktop launch (Electron-as-
  node ABI) — can't be checked in the normal gate.
- **Surfaces are desktop-only — deliberately off the mobile WS allow-list**
  (`REMOTE_ALLOWED_COMMANDS`). A sandboxed shell/browser over a tunnel is a real
  feature with its own threat model; revisit when mobile needs it.
- **"Add to agent" on a git-changed file assumes cwd === repo root.** `git status`
  paths are repo-root-relative; the absolute path is built from the workspace cwd.
  Correct for the common case; wrong when the workspace cwd is a repo subdir.
  File: `apps/desktop/src/shell/surfaces/FilesPane.tsx`.
- **The `terminal` tool's sentinel-based completion is best-effort** in a shared,
  input-echoing shell (it strips the echoed command + sentinel lines heuristically).
  Good enough for run-and-read; a structured exec channel would be cleaner.

## 2026-06-15 — built-in providers: z.ai / xAI / Google Gemini / local

- **New (`@moxxy/plugin-provider-{zai,xai,google,local}`):** four first-class
  built-in providers wired into `setup/builtins.ts`. All reuse the shared
  `OpenAIProvider` (and `AnthropicProvider` for z.ai's GLM Coding Plan path) with
  a per-vendor slug + base URL + model catalog — no new provider runtime, no new
  external deps. `AnthropicProvider.models` was made configurable (mirroring
  `OpenAIProvider`) so the z.ai plan-mode path advertises GLM models through it.
  `resolveProviderCredentials` gained a `local` no-key branch (Ollama default,
  `LOCAL_MODEL_BASE_URL` override), mirroring the `openai-codex`/`claude-code`
  special-cases.
- **New (low, freshness): hardcoded model catalogs now span 5 more providers.**
  This extends the existing P3 #8 debt (Anthropic catalog hand-maintained instead
  of derived from a Models API). z.ai/xAI/Gemini ship fast-moving IDs and context
  windows that were correct as of 2026-06-15 but will drift; unlisted IDs still
  work (passed straight through), so the catalogs only seed the picker + context
  budgets. A shared "OpenAI-compatible vendor catalog" derivation (or a
  `/v1/models`-backed refresh) would let all four self-update — same root as P3 #8.
- **Known limitation (carried from 2026-06-12, now wider):** the desktop Configure
  sheet still can't edit a built-in provider's `models` array — relevant now that
  four more catalog-carrying providers ship by default.
- **Note (wizard UX, low):** `local` is `auth.kind: 'apiKey'` so `moxxy init`'s
  `collectKey` would prompt for a (non-existent) key if a user picks `local` in
  the wizard. It still activates keyless on the runtime `/model` path via the
  credential branch above; a proper `{ kind: 'none' }` auth descriptor would let
  the wizard skip the prompt. Deferred (init is one-time; runtime switch is the
  main path).

## 2026-06-12 — desktop live registry refresh + interactive provider management

- **Retired (found + fixed same PR): desktop UI went stale after runtime registry
  changes** — `provider_add` (and mcp/skill/workflow mutations made by TOOLS inside a
  turn) updated the runner's live registries but nothing pushed the change to the
  renderer: the runner only broadcast `info.changed` on mode switch / provider
  setActive / command.run / transcribe, `SessionDriver` never forwarded it, and
  `useSettings` fetched once on mount — so a provider added via prompt needed an app
  RESTART to appear. Fix, end to end: the runner broadcasts `info.changed` after every
  completed turn (`server.ts` runTurn finally); `RemoteSession.onInfoChanged` exposes
  the push; `SessionDriver` forwards it as the new `session.info.changed` IPC event;
  `useSessionInfoBridge` (mounted in App) re-emits it as `SESSION_INFO_REFRESH_EVENT`;
  and `useSettings` re-fetches on that signal (mode badge / action catalog / agent
  picker already listened).
- **Protocol v7** (additive; MIN_COMPATIBLE stays 1; desktop `FLOOR_RUNNER_PROTOCOL`
  bumped in lockstep): `provider.setEnabled` (live toggle + persisted
  `preferences.json#disabledProviders`, seeded into the registry before boot's
  activation walk; disabling the ACTIVE provider is refused), `provider.refreshReady`
  (re-probe credentials via `session.credentialResolver` so a vault key flips
  readiness live), `provider.configure` (patch a stored provider through the new
  `SessionLike.providerAdmin` view — wired from `buildProviderAdminPluginWithApi`,
  mirrors mcpAdmin). Settings → Providers now has the enable/disable Switch + a
  Configure sheet (vault key for api-key providers, login hint for OAuth, stored
  baseURL/defaultModel for admin providers). The change-runner-protocol skill was
  refreshed (it still said "currently 3" + pre-tolerant-negotiation semantics).
- **New (low, ux):** the Configure sheet edits a stored provider's `baseURL` /
  `defaultModel` but not its `models` ARRAY — model-list edits still need
  `provider_add` (replace) or `settings.fetchProviderModels` + a future picker.
- **New (low, consistency):** `provider.setEnabled` persists the disabled list via a
  fire-and-forget read-merge-write of preferences.json; two rapid toggles of
  DIFFERENT providers from two clients could lose one update (same best-effort
  semantics as every `savePreferences` caller — acceptable, noted for completeness).

## 2026-06-11 — mobile-poc app intake

`apps/mobile-poc` (Expo SDK 54, single screen) replaces the removed `apps/mobile` as the
smallest app proving the mobile channel end to end (QR pairing → chat → ask round-trip).

- **Retired:** the "remove broken apps" commit (508f5d8) left `apps/desktop`'s
  `ws-bridge.test.ts` importing the deleted `apps/mobile/src/pairingQr` — `pnpm typecheck`
  on main was red. The client half of the pairing contract (`splitConnectUrl`) now lives in
  `@moxxy/client-transport-ws`, and both the PoC app and the desktop round-trip test consume
  it from there (no app→app imports).
- **M1 [med, security/feature gap] LAN pairing is cleartext `ws://`** — the bridge
  (`createWebSocketTransportServer`) constructs a plain `WebSocketServer` with no TLS
  option, so a `MOXXY_MOBILE_HOST=0.0.0.0` bind sends the bearer handshake unencrypted on
  the LAN. Even with a TLS option, RN/Expo Go cannot trust a self-signed cert for a private
  IP (no pinning escape hatch), so the secure phone path is the tunnel (`wss://`, publicly
  trusted cert) — the PoC README now leads with it. **Action** if direct-LAN encryption ever
  matters: add an optional `https.Server` (cert/key) to `WebSocketBridgeOptions` + a dev-build
  (non-Expo-Go) pinning story; until then, treat LAN binds as trusted-network-only.
- **M2 [low, dx]** the PoC consumes workspace packages as built `dist` — editing any
  `@moxxy/*` package needs a root `pnpm build` before Metro sees it (documented in the README).
- **Retired (2026-06-11): real iPhones were rejected by the Origin default-deny.** The A27
  hardening assumed "native clients send no `Origin` header" — false on iOS: React Native's
  WebSocket (SocketRocket) sends an Origin derived from the dialed URL (ws→http, wss→https,
  default ports elided), so every real-device pairing (tunnel or LAN) failed at the upgrade
  with `rejected browser-origin upgrade`. Android (OkHttp) and Node send none, which is why
  tests/simulator-on-node never caught it. Fix: `WebSocketBridgeServer.setAllowedOrigins`
  (live update — the tunnel URL only exists after start) + the mobile channel and desktop
  gateway allow-list exactly the origins of the URLs they advertise (`advertisedOrigins` /
  `connectUrlOrigin` in `plugin-channel-mobile/pairing.ts`). Default-deny otherwise unchanged.

## 2026-06-10 round-2 audit intake — mobile gateway

A targeted round-2 audit of the runtime mobile gateway shipped by PR #141 (the
Settings → Mobile tab). Numbered B1+ so the A-series cross-refs stay stable.
Severity in brackets.

- **B1 [critical/high, security regression] Desktop mobile gateway exposed the FULL host
  IPC to remote clients** — ✅ FIXED (this PR): `registerIpcHandlers([electronBus, wsBus], …)`
  wired the COMPLETE handler set onto the LAN-bound WebSocket bus, and the only remote filter
  was a BLOCKLIST (`REMOTE_DISALLOWED_COMMANDS`) that omitted host-mutating commands — so a
  paired phone (or anyone on the LAN with the bearer token) could call `session.setAutoApprove`
  (disable approval prompts → run any tool unattended), `desks.create`/`rename`/`remove`,
  `onboarding.saveProviderKey`/`openExternal`, `app.updateCli`/`checkUpdate`/`updateDashboard`,
  vault/settings/prefs writes, and `mobileGateway.*` — a privilege-escalation / RCE-adjacent
  hole. **Inverted to ALLOW-by-default-deny:** the contract now exports `REMOTE_ALLOWED_COMMANDS`
  (the single source of truth for the remote/mobile trust surface — session info/runTurn/abort/
  setMode/newSession/runCommand, transcribe, ask RESPOND, connection discovery/retry, the
  per-workspace transcript log, and `workflows.list`/`run`/`getRun`), and `WebSocketCommandBus`
  rejects anything not on it with a coded error regardless of registered handlers. The Electron
  (renderer) bus keeps full access. The standalone `moxxy mobile` host self-curates and opts out
  via `new WebSocketCommandBus({ allowedCommands: null })`. Also fixed in the same area:
  workflow AUTHORING (`save`/`validateDraft`/`setEnabled`) is host-only (read/run only over the
  wire); `MobileGatewayManager` start/stop/rotate/resume now serialize through a lifecycle lock
  (no double-bind / leaked listener on a rapid off→on); token rotation is coherent with a pinned
  `MOXXY_WS_TOKEN` (no-op + warn, status always reflects the live accepted token); and the Mobile
  tab warning now states plainly the connection is unencrypted `ws://` and passively interceptable.
  Tests: deny/allow allow-list matrix in `ipc-server-ws`, plus serialization + pinned-rotate
  coherence in the desktop `ws-bridge` suite. The wave-5 hardening (Origin default-deny, bearer
  subprotocol, connection caps) verified still applied on the runtime-gateway path.

- **B2 [high, shipped regression] Desktop hot-update could strand its runner on a protocol skew**
  — ✅ FIXED (this PR, branch `fix/runner-protocol-skew`). A Tier-1 JS hot-update ships only
  `dist/` + `dist-electron/`, so it bumps the bundled `@moxxy/runner` CLIENT
  (`RUNNER_PROTOCOL_VERSION`) but NOT the separately-bundled CLI the desktop spawns as its runner
  (resolved by `preferredCliEntry` → `resourcesPath/moxxy-cli`). After a v3→v4 hot-update the
  client was v4 and the runner v3; the server's STRICT `protocolVersion !== RUNNER_PROTOCOL_VERSION`
  handshake threw, and the supervisor's "stale runner" recovery respawned from the SAME pinned CLI
  → still v3 → infinite "Reconnecting…". (v3→v4 was purely additive — the rejection was needless.)
  **Three-part fix:** (A) tolerant negotiation — `MIN_COMPATIBLE_PROTOCOL_VERSION` (=1, bump only
  on a BREAKING change) gates the handshake; the server accepts any client `>= MIN_COMPATIBLE` and
  reports its own version; the client records the server version and gates the v4-only
  `workflow.validateDraft/save/getRun` builder methods on it, degrading with an actionable "update
  the CLI" error instead of a raw method-not-found. (B) desktop lockstep (Option 1) — the signed
  app-bundle manifest now carries a `runnerProtocol` stamp, and the bootstrap's
  `resolveActiveBundleDetailed` refuses to activate (reverts to floor) any bundle whose stamp
  EXCEEDS the spawnable CLI's protocol (`runner-protocol-skew` reject reason; floor protocol baked
  as `FLOOR_RUNNER_PROTOCOL`, build asserts it == runner's). (C) UX — a persistent mismatch now
  surfaces a TERMINAL `protocol-incompatible` connection phase (no Try-again, actionable hint,
  vX/vY in Technical Details) after ONE failed recovery instead of an endless retry loop.
  **Deferred follow-ups:** (1) `checkForUpdate` still OFFERS/downloads a skewed bundle — the
  activation gate idempotently reverts it to floor every boot (no loop/crash), but a check-time
  `cliRunnerProtocol` gate would avoid the wasted download + the surprised "update available then
  nothing changes". (2) The deepest fix is to STOP a JS hot-update from outrunning the CLI at all
  — i.e. ship the pnpm-deployed CLI INSIDE the Tier-1 bundle so client+runner update in lockstep
  (Option 2). Larger (bundle bloat + cli-resolver/bootstrap prefer-the-bundle plumbing); left for a
  dedicated PR now that Part A makes additive skew non-fatal and Part B/C make any future breaking
  skew terminal-but-clear rather than a loop.

## 2026-06-09 audit intake — confirmed findings awaiting fixes

Every item below survived an adversarial verification pass (an independent agent
instructed to refute it). Numbered A1–A13 so the existing #1–#10 cross-refs stay stable;
fold each into P1/P2 or the resolved ledger as fixes land. Severity in brackets.
Full report incl. the medium/low backlog and refuted findings:
`.claude/audits/main-audit-2026-06-09.md`.

- **A1 [critical, regression] Packaged desktop main couldn't resolve `@moxxy/ipc-server-ws`**
  — static import (PR #120) without a `BUNDLED_WORKSPACE_DEPS` entry → MODULE_NOT_FOUND at
  boot in every packaged 0.0.33 build + the hot-update bundle re-poisons self-update.
  **FIX IN FLIGHT: PR #126** (bundles the package + guarded dynamic import). Do not publish
  the `desktop-v0.0.33` draft release until rebuilt.
- **A2 [high, security] Self-update bootstrap never verifies the bytes it executes** — ✅ FIXED
  (this PR): the manifest now signs a per-file sha256 map (`files`) alongside the archive
  hash; `verifyBundleFiles` checks every listed file's bytes at stage time (before
  activation) AND in `resolveActiveBundleDetailed` at every load (`file-tampered` reject
  reason in the boot-log). Legacy manifests without the map are grandfathered (still load,
  still not load-time-verified — docs now say so plainly); stripping the map from a new
  manifest breaks its signature.
- **A3 [high, security] Goal-mode auto-approve bypasses user deny rules** — ✅ FIXED
  (this PR): the session resolver now exposes a prompt-free `policyCheck` (SDK
  `PermissionResolver` optional method, implemented by core's `wrapWithPolicy`), and goal
  mode's auto-approve consults it first — so permissions.json deny/allow rules and
  tool-declared rules still apply unattended while nothing can ever block on a prompt;
  deny-under-goal + policyCheck tests added.
- **A4 [high, security] Webhook `allowedTools` "sandbox" is not enforced** — ✅ FIXED
  (this PR): `cli/src/setup/webhook-runner.ts` now runs each fire against a per-fire
  scoped session view (filtered tool registry + wrapping resolver whose `check` AND
  prompt-free `policyCheck` deny anything outside `allowedTools`, delegating allowed
  calls to the session's current resolver chain — race-free for concurrent fires, no
  shared-session mutation); empty list = full tool set (now documented), and the
  tool/setup-guide text says fires run on the ACTIVE session, not an isolated one.
- **A5 [high, security] `browser_session.goto` has no SSRF guard** — ✅ FIXED (this PR):
  `assertPublicUrl` hoisted into a shared `plugin-browser/src/ssrf-guard.ts` and enforced
  in the parent goto handler, in the sidecar's goto dispatch (defence in depth), and via a
  context-level `route()` interceptor that blocks in-page/redirect navigations to private
  origins; subresource requests stay unfiltered (residual risk documented in the tool
  description instead of a parity claim).
- **A6 [high, security-adjacent] `provider_test` takes the raw API key as model-visible
  tool input** — ✅ FIXED (this PR): plaintext `apiKey` input removed outright; the tool
  takes a vault `keyName` resolved at call time via `ctx.getSecret` (actionable
  missing-secret/no-vault messages), and the add-provider skill + provider_add guidance
  now route verification through the vault name.
- **A7 [high, stability] channel-web kills whatever holds its port** — ✅ FIXED (this PR):
  channel EADDRINUSE recovery and the runner's protocol-mismatch recovery both verify the
  holder's `ps` command line carries a moxxy marker before any TERM/KILL (CLI now sets
  `process.title = 'moxxy …'` so dev daemons match); non-moxxy holders are left alone and
  the web channel falls back to an ephemeral port, logging requested + bound ports.
- **A8 [high, stability] channel-web WS frames are not schema-validated** — ✅ FIXED (this
  PR): zod `clientFrameSchema` (drift-guarded against `ClientFrame`) safeParses every
  inbound frame; invalid/oversized frames are dropped with a rate-limited warn, the WSS is
  created post-bind + given an error handler (ws re-emits server errors → was a second
  crash path), and `bin.ts` installs last-resort guards (`process-guards.ts`: log+survive
  unhandledRejection, log+flush+exit 1 on uncaughtException).
- **A9 [high, stability] CLI probe/light-boot sessions leak daemons** — ✅ FIXED (this
  PR): new `probeSession(opts, read)` in `cli/src/setup.ts` forces `skipInitHooks` +
  `disableSessionPersistence` and closes the session in a `finally` (onShutdown fires even
  when `read` throws); converted `run-tui.ts` (needs-init probe), `bin.ts`
  (channel-existence probe), `run-channel.ts` + `channels.ts` (registry light-boots —
  wizard runs inside the probe, the headless path boots the real daemon-owning session
  after the probe closes), `schedule.ts` store ops, and `setup-cmd.ts`/`plugins.ts list`
  reads. Still open (milder, one-shot processes that exit promptly): `moxxy -p`,
  `schedule run`, `doctor`, `login`/`init` boot full sessions and never `close()`.
- **A10 [high, stability] `/new` on attached clients is cosmetic and bricks the mirror** —
  ✅ FIXED (this PR): new `session.reset` RunnerMethod (protocol v3) + `SessionLike.reset?()`
  capability — the runner aborts in-flight turns and clears its authoritative log, whose new
  `EventLog.onClear` listeners broadcast a `session.reset` notification (every mirror clears
  in lockstep, re-arming seq-0 ingest) and truncate the persistence JSONL (same hook fixes
  local `/new` resurrecting on `--resume`); TUI/Telegram call `reset()` and surface an error
  instead of claiming success when it fails.
- **A11 [high, stability] `afterWorkflow` triggers have no cycle detection** — ✅ FIXED
  (this PR): a per-run trigger chain now rides the `workflow_completed` payload (re-fires
  that revisit a chain member or exceed depth 8 are refused with a warning), and static SCC
  detection at trigger-sync time disables auto-refire for cycle members
  (`cli/src/setup/workflows.ts`).
- **A12 [high, stability] `safe-publish.mjs` publish-order/tombstone hazard** — ✅ FIXED
  (this PR): publishes in topo order over `workspace:` deps (so a dependency's tombstone
  bump, persisted to its package.json, is exactly what a later dependent pins at pack
  time), blocks dependents of a failed publish, and a post-publish `npm view` check
  verifies every shipped `@moxxy/*` pin exists on the registry (loud + exit 1 otherwise);
  helpers unit-tested via `pnpm test:scripts`.
- **A14 [medium, stability] Corrupt/schema-mismatched `webhooks.json` silently treated as
  empty — the next write wipes every trigger (and its secrets)** — ✅ FIXED (this PR):
  fail-safe load in `plugin-webhooks/src/store.ts` — a corrupt file is renamed aside to
  `webhooks.json.corrupt-<ts>` before the store starts empty (non-ENOENT read errors refuse
  all reads/writes instead), per-entry schema failures keep the valid triggers and
  quarantine the rest to a 0600 sidecar, and the condition is logged + surfaced as
  `storeWarning` in `webhook_list`/`webhook_create`/`webhook_status`.
- **A15 [medium, security] Generated webhook secrets returned through the model's context
  and persisted in session logs** — ✅ FIXED (this PR): `webhook_create`
  (`plugin-webhooks/src/tools.ts`) now returns only a masked preview (`abcd…`) plus the
  path of a 0600 file under `~/.moxxy/webhooks-secrets/` holding the full value for the
  user to read directly (removed again on `webhook_delete`); list/status stay redacted via
  `redactVerification`, and the tool description + setup-guide hints route the secret out
  of band.
- **A16 [medium, stability] Bash tool timeout/abort only SIGTERMed the shell PID** — ✅ FIXED
  (this PR): the shell is spawned `detached` (own process group, POSIX) and timeout/abort
  now signal the whole group (`process.kill(-pid)`) with SIGTERM → 2s grace → SIGKILL
  escalation (ESRCH swallowed, single-PID fallback on win32); also unhangs `close` when an
  orphan held the stdio pipes (`tools-builtin/src/bash.ts`).
- **A17 [medium, performance] Bash tool buffered child output unboundedly before the
  post-exit 200k clamp** — ✅ FIXED (this PR): output is now retained only up to the clamp
  limit (+4k margin) per stream during streaming, the rest drained-and-counted so the
  command still completes with its real exit code and the existing
  `... [truncated N chars]` marker reports the true overflow (`tools-builtin/src/bash.ts`).
- **A18 [medium, stability] Single-use rotating refresh tokens (claude-code, openai-codex)
  had no cross-process or cross-consumer serialization, and vault persistence was whole-file
  last-writer-wins from an in-memory snapshot** — ✅ FIXED (this PR): refresh+persist now runs
  under a per-credential lock (`withCredentialLock` in plugin-oauth: in-process mutex +
  best-effort O_EXCL lockfile under `<moxxy home>/locks` with stale takeover) with re-read
  coalescing (followers adopt the winner's rotated tokens; one IdP call) and an
  invalid_grant→re-read-vault→retry-once recovery in ensureFreshTokens, the claude-code
  refresh helpers, and CodexProvider (new `reloadTokens` hook); `VaultStore` now
  read-merge-writes (mtime-gated disk sync, newer-`updatedAt`-wins per key) instead of
  persisting its snapshot.
- **A19 [medium, stability] `RunnerSupervisor.restart()` used bare `child.kill()` + immediate
  respawn** — ✅ FIXED (this PR): restart() now awaits the same graceful `terminateChild`
  (SIGTERM → 2s grace → SIGKILL, resolved on actual exit) every other teardown path uses, so
  a quick post-update restart can't race the dying serve for the socket (EADDRINUSE); pinned
  by new supervisor lifecycle tests.
- **A20 [medium, packaging] `@moxxy/desktop-host` imported `@moxxy/core` in prod source while
  declaring it only as a devDependency** — ✅ FIXED (this PR): moved to `dependencies`
  (`workspace:*`); same missing-prod-dep class as the A1 release blocker.
- **A21 [medium, packaging] `@moxxy/mode-goal` imports `zod` at runtime but declared it only
  as a devDependency** — ✅ FIXED (this PR): moved to `dependencies` (`catalog:`), matching
  the other zod-consuming packages.
- **A22 [medium, release] Desktop release tag was pushed before the installers built — any
  desktop-build failure permanently burned that version** — ✅ FIXED (this PR): the cut step
  now only decides version + pinned sha; guard/build jobs check out the sha, and the
  `desktop-v<version>` tag is pushed (idempotently, at that same sha) in `desktop-release`
  only after every build leg succeeds, preserving PR #85's tag↔artifact-match invariant.
- **A23 [medium, stability] `EventLog.ingest` discards async listener rejections** —
  ✅ FIXED (this PR): the fire-and-forget dispatch now attaches a `.catch` to the listener's
  promise (`Promise.resolve(fn(event)).catch`), swallowing rejections under the same
  non-fatal policy as `append()`'s awaited try/catch instead of leaking an unhandled
  rejection that can kill the process.
- **A24 [medium, stability] session event-log persistence silently swallows write
  failures** — ✅ FIXED (this PR): append/truncate queue failures now emit one loud
  structured `logger.warn` per failure streak (path + op + error, injectable
  `SessionPersistenceOpts.logger`, stderr JSON by default), latch a
  `SessionPersistence.degraded` flag, and a subsequent successful write clears the latch
  (logging recovery) and re-arms the warn-once gate.
- **A25 [medium, stability] restored session logs never re-sequenced — one corrupt middle
  line truncates every mirror's replay at the gap** — ✅ FIXED (this PR): `restoreEvents`
  counts skipped corrupt lines, rewrites the in-memory events to contiguous seq 0..n-1
  (order/ids preserved, so `EventLog.ingest`'s `seq === length` gate replays the full
  post-gap history and `append` mints non-colliding seqs), warns with the counts, and
  atomically rewrites the repaired JSONL on disk (safe: restore runs before
  `SessionPersistence.attach`, so no write queue is live) so the next resume is clean.
- **A26 [medium, stability] empty assistant_message (tool-only end_turn) projects as an
  empty text block providers reject — wedges the session log** — ✅ FIXED (this PR) at the
  projection layer: `projectMessages` (sdk/mode-helpers) now skips whitespace-only
  `assistant_message` content while keeping the grouped `tool_use` blocks, which also
  un-wedges historical logs. Residual: the emitting sites
  (mode-default/mode-goal/mode-deep-research loops) still log the empty event — harmless
  to providers now, but a source-side guard there is a cheap follow-up (out of this
  wave's package scope).
- **A27 [medium, security] WS-bridge auth hardening: no Origin validation, token in the
  URL query, no rotation/expiry** — ✅ FIXED (this PR): upgrades carrying a browser
  `Origin` header are rejected unless allow-listed (`allowedOrigins`, default deny;
  native clients send none), the token now travels as `Authorization: Bearer` or a
  `Sec-WebSocket-Protocol` `moxxy.bearer.<encoded>` entry (shared sdk channel-auth
  helpers) with the legacy `?t=` query OFF by default (opt-in `allowQueryToken`; the
  mobile channel keeps it for already-paired apps — the QR still embeds `?t=` as a
  pairing payload, but the app strips it before connecting), and rotation exists end to
  end: `rotateChannelToken` (sdk) + `rotateAuthToken` on the live server (terminates
  existing connections) + `rotateWsBridgeToken` (desktop) / `MobileChannel.rotateToken`,
  with a soft 90-day staleness warning from the persisted `createdAt`.
- **A28 [medium, stability] WsRpcClient replays abandoned requests after reconnect and
  reconnects forever with no surfaced failure** — ✅ FIXED (this PR): on disconnect every
  in-flight AND queued request is rejected and the outbox cleared (no silent re-execution
  of non-idempotent commands like runTurn), reconnects back off exponentially (1.5s → 30s)
  and give up after a cap (default 10), surfacing a terminal `disconnected` status via
  `onStatus`/`client.status`, after which requests reject immediately.
- **A29 [medium, stability] WS-bridge server lifecycle/backpressure: unbounded send
  buffering, no connection cap, close() waits out clients** — ✅ FIXED (this PR):
  concurrent connections are capped at the handshake (default 8), every outbound frame
  consults a `SlowReaderGuard` (a socket whose backlog stays above 4 MB past a 10s grace
  is terminated — the grace tolerates one legitimately large frame in flight), and
  `close()` terminates remaining sockets before closing the listener so desktop quit no
  longer burns the 3s shutdown timeout.
- **A30 [low, hygiene] WS-bridge config/dedup: empty `MOXXY_WS_PORT` binds an ephemeral
  port, `address` reports the requested (not bound) port, desktop re-rolls token
  persistence** — ✅ FIXED (this PR): empty/whitespace port env is treated as unset,
  `address` is built from `wss.address()` (real bound port, so `port: 0` is honest),
  and desktop's `loadOrCreateToken` is gone in favor of the shared sdk
  `resolveChannelToken` (new `dir` option keeps the userData location; legacy plain-text
  token files still read).
- **A31 [medium, security] Runner socket unauthenticated: chmod-after-listen race +
  swallowed failure, no Windows pipe ACL, cross-client abort untracked** — ✅ FIXED (this
  PR): the socket's parent dir is secured 0700 BEFORE listen (fresh dirs born private,
  owned pre-existing dirs tightened in place — layout unchanged since desktop-host
  hardcodes the paths), socket chmod failures now log loudly instead of being swallowed,
  and aborts are ownership-tracked: a cross-client abort stays allowed (shared-session
  model) but emits an audit log with both roles, with `MOXXY_RUNNER_STRICT_ABORT=1`
  opting into denial. Documented gap: win32 named pipes keep the default DACL (Everyone:
  read-only, no write) — Node can't set an explicit ACL; a one-time warn states this.
- **A32 [low, docs] Docs drift reconciled** — ✅ FIXED (this PR): AGENTS.md no longer names the
  deleted `@moxxy/mode-tool-use` as the default mode (it's `@moxxy/mode-default`; first
  registered mode auto-activates), AGENTS.md/README.md architecture lists now cover all
  50+ packages incl. the PR #120 client layer (client-core/platform-web/transport-ws,
  ipc-server-ws, design-tokens, plugin-channel-mobile, apps/mobile) + plugin-channel-web/
  plugin-view/skills-builtin, the published sdk README's examples were rewritten against the
  real API (modes default/goal/research, ProviderDef.createClient, real hook names, real
  isolation/compact shapes), docs tools-builtin.md states eight tools and no core dependency,
  testing.md samples use the actual `@moxxy/testing` exports, quickstart says four providers,
  and a complete package index page (`apps/docs/.../packages/overview.md`) covers every package.
- **A33 [low, dead-code] Dead exports removed** — ✅ FIXED (this PR): core's unused
  `selectPendingToolCalls`/`selectCurrentTurn` selectors (zero importers; file + tests deleted)
  and the sdk voice helpers (`checkTranscriberReady`/`resolveTranscriber`/
  `pickFirstAvailableTranscriber`, zero importers — the three live transcriber-activation
  copies in channels never adopted them) are gone from the public surfaces.
- **A34 [low, hygiene] plugin-telegram zod dep + dead turbo lint task** — ✅ FIXED (this PR):
  removed `zod` from plugin-telegram's dependencies (never imported) and the `lint` task from
  turbo.json (no package defines a lint script; root `pnpm lint` runs `eslint .` directly —
  wiring lint through turbo would need per-package lint scripts, judged not worth it now).
- **A35 [low, docs] MOXXY_* env vars documented** — ✅ FIXED (this PR): full table added to
  README ("Environment variables", 20+ vars incl. the PR #120 WS-bridge/mobile set:
  MOXXY_WS_BRIDGE/PORT/HOST/TOKEN, MOXXY_MOBILE_TOKEN/HOST/TUNNEL) and the CLI `--help` ENV
  section extended with the user-facing ones + a pointer to the README table.
- **A36 [med, inconsistency] Codex provider silently dropped req.maxTokens/req.temperature;
  reasoningEffort pinned to 'medium'** — ✅ FIXED (this PR): `maxTokens` now maps to the
  Responses `max_output_tokens`; `temperature` is documented-unsupported (gpt-5 reasoning
  models 400 on sampling params) with a one-shot MOXXY_DEBUG note instead of a silent drop;
  `reasoningEffort` is a live `CodexProviderConfig` option and the CLI's codex credential
  resolver now merges `provider.config` through (it used to discard every configured option).
  **Corrected 2026-06-11:** the `max_output_tokens` mapping was itself a regression — the
  ChatGPT-plan `/responses` endpoint (unlike the platform Responses API) 400s with
  `Unsupported parameter: max_output_tokens`, observed live when `workflow_create` passed its
  draft budget (the only caller that sets `req.maxTokens`; normal turns leave it unset, which
  is why chat never hit it). `req.maxTokens` is now dropped with a one-shot MOXXY_DEBUG note,
  exactly like `temperature`; `draftWorkflow` additionally clamps its budget to the model's
  catalog `maxOutputTokens` and surfaces a `max_tokens`-truncated draft as an actionable error.
- **A37 [med, inconsistency] Runtime-registered openai-compat providers were second-class** —
  ✅ FIXED (this PR): the live client now reports the vendor's slug + model catalog
  (`OpenAIProviderConfig.name`/`models`, wired from `buildProviderDef`) so usage/errors
  attribute correctly; vault/env key naming unified into `providerApiKeyName` /
  `storedProviderApiKeyName` in plugin-provider-admin (CLI `canonicalKey` delegates, gains
  `-`→`_`; `resolveProviderCredentials` honors the stored `envVar` override the desktop
  already used; desktop's `envVarFor` matches the helper's semantics verbatim); and
  `provider_add`'s model schema accepts `supportsDocuments` (zod was stripping it, degrading
  attachments for every runtime provider).
- **A38 [med, dead-end] `req.system` was dead weight — hook-injected system text (memory
  consolidation nudge) silently dropped** — ✅ FIXED (this PR): contract decided as
  "delivered IN ADDITION to system-role messages": loop helpers no longer prefill it
  (`collectProviderStream` dropped the duplicating `system: ctx.systemPrompt`), all three
  HTTP providers now append it (anthropic: extra uncached system block after the cache
  breakpoint; openai: system message after the leading prompt; codex: appended to
  `instructions`, also de-duplicating the base prompt codex used to send twice), pinned by a
  mode-default end-to-end test of the plugin-memory nudge pattern.
- **A39 [med, perf] TUI estimateContextTokens re-walked the whole log per render (~30Hz)** —
  ✅ FIXED (this PR): `plugin-cli/src/context-estimate.ts` now caches the running char total
  per log (WeakMap) and folds in only NEW events; unchanged logs are a pure cache hit, wipes
  (`/new`, `session.reset`) are detected by event-id identity, and elision/compaction/recall
  events fall back to the full SDK-identical walk (result equality asserted against the SDK).
- **A40 [med, perf] desktop chat-log loadSegment re-read+parsed the entire NDJSON per page** —
  ✅ FIXED (this PR): per-file line-offset index (byte offsets of valid event lines, size/mtime
  guarded) cached alongside the PR #107 id cache; pages now seek-read only their byte range,
  appendEvents extends the index in place, clearLog/migrate drop it; public API unchanged.
- **A41 [med, perf] MemoryStore O(N) re-index per write + unbounded growth** — ✅ FIXED (this
  PR): MEMORY.md rows cached in memory (hydrated once, updated per save/forget under the
  existing mutex — no per-write re-read of every file) + a configurable WARN-ONLY soft cap
  (`maxMemories`, default 500, surfaced via `capStatus()` and the `memory_save` tool result);
  eviction deliberately NOT implemented — memories are user knowledge, silent oldest-eviction
  would be silent data loss.
- **A42 [low, perf] goal-mode nudge defeated the stable-prefix rolling tail breakpoint** —
  ✅ FIXED (this PR): the nudge is declared volatile (`volatileTailCount` →
  `CacheStrategyContext.volatileTailMessageCount`) and stable-prefix now places its tail
  breakpoint on the last STABLE message, so idle goal iterations re-read the cached prefix
  instead of writing a never-read one. Also **A42b [med, missing]**: the default compactor's
  "summary" was a first-5-lines truncation with fabricated `tokensSaved` (`slice.length * 30`)
  — compactor-summarize now summarizes via the session's own provider/model (handed in through
  `CompactContext`), falls back to an honest, labeled head+tail digest (with a one-time warn)
  only when no provider is reachable, and computes `tokensSaved` from real char deltas.
- **A43 [med, security] MCP server credentials flowed plaintext through tool args and to disk**
  — ✅ FIXED (this PR): `${vault:NAME}` placeholders in MCP env/header values now resolve at
  CONNECT time only (`plugin-mcp/src/admin/secrets.ts`, resolver wired from setup via the
  vault's `resolveString`; every connect path — hot-attach, lazy, cache refresh,
  mcp_test_server); mcp.json and tool args keep the placeholder, tool descriptions instruct
  vault-first (mirrors A6), literal values pass through for back-compat.
- **A44 [med, security] Agent-view links allowed `javascript:` URLs (click-XSS) — validateDoc
  omitted URL checks and the web renderer never re-validated** — ✅ FIXED (this PR): canonical
  `isSafeViewUrl` allow-list in the sdk (https/http/mailto/tel + relative; `data:image/*` for
  img src only), enforced by `parseView` AND `validateDoc` (hand-built ASTs can no longer
  smuggle schemes), and re-checked at render time by the web frontend (verbatim copy in
  `frontend/url-safety.ts` — the browser bundle can't import the sdk root): unsafe hrefs render
  as plain text, unsafe img srcs as an inert placeholder.
- **A45 [med, security] web_fetch SSRF guard had a DNS-rebinding TOCTOU (check and fetch
  resolved independently)** — ✅ FIXED (this PR): `assertPublicUrl` returns the vetted
  addresses and every hop's fetch is pinned to them via an undici
  `Agent({ connect: { lookup } })` dispatcher (`createPinnedLookup` in web-fetch.ts) — the
  connection provably goes to the checked IP, per redirect hop, with SNI/cert validation
  intact; a rebinding second DNS answer is never consulted.
- **A46 [low, security] Telegram inline-keyboard callbacks skipped the pairing gate that
  text/voice enforce** — ✅ FIXED (this PR): `handleCallback` now requires
  `pairing.isAuthorized(chatId)` before any prefix dispatch (perm/appr/model/mode), denying
  unpaired chats and chat-less inline callbacks; update-dispatcher sweep found no other
  ungated session-reaching paths (`/start` is the pairing flow itself, by design).
- **A47 [low, docs] desktop deployment docs drifted from the release/self-update mechanisms**
  — ✅ FIXED (this PR): code-signing.md + desktop-self-update.md reconciled against
  release.yml (tag-after-build), the signed per-file integrity map, DOM health-confirm,
  ESM marker, and boot-decision log.

---

## P1 — High

### 1. Runner/thin-client: retype channel handlers to the SDK contract — ⚠️ PARTIALLY DONE
**Findings:** plugin-cli #4, plugin-telegram #6, cross-cut 2.4 (all **high**).
**Done:** `CredentialResolver`, `McpAdminView`/`McpServerStatusView` live on `@moxxy/sdk`;
`SessionLike` carries optional `readyProviders?`/`credentialResolver?`/`mcpAdmin?`
(`packages/sdk/src/session-like.ts:245-249`). The cli handlers now import
`ClientSession as Session` from `@moxxy/sdk` and read the capabilities through optional
chaining (`plugin-cli/src/.../picker-handlers.ts`, `use-mcp-status.ts`, `run-slash.ts`).
**Desktop-host seam casts retired (2026-06-10):** the two `RemoteSession` casts this item
cross-referenced are gone. `ipc/shared.ts`'s `mustSession` no longer does
`mustRemote(...) as unknown as SessionLike` — `RemoteSession implements ClientSession`
which `extends SessionLike`, so it's assignable directly. `ipc/session.ts`'s
`runCommand` no longer casts the session into the command handler — `CommandContext.session`
is `unknown`, so the `RemoteSession` passes through with no cast. Both verified by
`pnpm -w typecheck`.

**Remaining (deferred — the genuine coupling):** `ClientSession` still exposes the full
concrete registry surface (providers/modes/tools/commands/…), so the cli handlers would not
yet compile against a bare `RemoteSession`. Retyping the handler params to the minimal
`SessionLike` slice they actually use (and verifying graceful degradation when a
`RemoteSession` leaves a capability undefined) is the real remainder — it depends on the
unbuilt runner/thin-client split (`SessionLike`/`RemoteSession` becoming the channel-facing
contract). Do it alongside that work, not standalone; it is **not** a safe mechanical
change today.

### 2. Desktop persists every conversation twice — pick one source of truth — ⚠️ PARTIALLY DONE
**Found 2026-06-08 (the "NDJSON-vs-replay redundancy" follow-up).** Every committed event
is written to disk in **two** independent stores:
- runner session log — `~/.moxxy/sessions/<id>.jsonl`, replayed on attach
  (`runner/src/server.ts` `handleAttach`);
- desktop NDJSON chat-log — `~/.moxxy/chats/<workspaceId>.jsonl`
  (`desktop-host/src/chat-log.ts`), the renderer's windowed mirror.

**Mechanism corrected + replay cost fixed (2026-06-11, runner protocol v6).** Empirically
the attach replay never reached the renderer at all: the `SessionDriver` subscribes to the
host-side mirror only AFTER attach completes, so the renderer transcript has always come
solely from `chat.loadSegment` over the NDJSON store. The replay's only effect on desktop
was COST — replaying the full event log (~95% `assistant_chunk`) into desktop-host's
`RemoteSession` mirror on every app start / desk switch / cwd change / reconnect, with the
composer-ready gate waiting on it. Fixed: `attach` now takes a `replay` param
(`'full' | 'none' | { tail }`, default `'full'` preserves TUI/`moxxy attach`), the server
announces the start seq via a `replay.start` notification, the client mirror rebases to it
(`EventLog.rebase`), and the desktop supervisor attaches with `replay: 'none'`. So the two
stores are no longer redundant on desktop: the runner JSONL feeds resume/context, the
NDJSON feeds the renderer transcript.

**Fixed (2026-06-08, PR #107):** the **unbounded NDJSON growth** defect. Because the runner
replays the full history on every restart and the renderer re-appends each replayed event,
the NDJSON log used to grow by a complete copy of the conversation per restart — and since
`loadSegment`'s cursor is a line index, the doubled file also corrupted scroll-up
pagination. `appendEvents` is now **idempotent by event id** (lazy file-path-keyed id cache),
so the log holds one copy and its cursors stay stable. +5 chat-log tests.

**Remaining (the real decision):** the dual on-disk history itself. The runner session
JSONL still holds the complete history (replayable via `replay: 'full'` / `{ tail }`), so
one of the two stores could in principle be retired — but with the desktop now attached via
`replay: 'none'`, the NDJSON store is the renderer's ONLY history source, so any
consolidation must move it to the runner log (paged reads), not just delete it.
Counter-risk: legacy
localStorage→NDJSON-migrated chats may live ONLY in NDJSON, not in any runner session log,
so a naive drop loses early-adopter history. **Needs a product call + desktop-app
verification — not a mechanical change.** Note (2026-06-09): the shared client layer (PR
#120) wires the same append-on-dispatch persistence into EVERY connected client (WS/mobile
included, `client-core/src/chat-store/store.ts:325`), so multi-client setups now lean even
harder on the host-side id-dedup cache — one more reason to make the host the single writer.

**Also remaining:** the **`/new` desync window**. The renderer still clears its store before
the runner reset confirms; if the reset fails or the app dies between them, the two desync
and old context resurrects. Make `/new` reset the runner FIRST and only clear the
renderer/NDJSON on success (or a single atomic IPC). **This path still has zero tests** —
no `store.test.ts`; `resetSession`/`newSession`/`deleteSession` in `runner-supervisor.ts`
are uncovered.

---

## P2 — Medium

### 3. Shared HTTP-channel server base — OPEN
**Cross-cut 1.4.** `readRequestBody` + `bearerTokenMatches` are shared (done), but each
HTTP surface still rolls its own `createServer`/`listen`/health/routing
(`plugin-channel-http/src/channel.ts:60`, `plugin-channel-web/src/channel.ts:180`,
`plugin-webhooks/src/server.ts:63`). The new `@moxxy/ipc-server-ws` WebSocket bridge
reuses `bearerTokenMatches` for its handshake (consistent with the shared-auth direction)
but is a WebSocket surface, not request/response, so it sits beside this base rather than
under it. **Action:** an optional `HttpChannelServer` base in the SDK so they differ only
in routing. (Larger refactor, lower payoff than the helpers already hoisted.)

### 4. Unify tunnel subprocess management + make webhooks use `TunnelProviderDef` — ✅ FIXED (2026-06-10)
**Cross-cut 1.5.** Was three near-identical spawn-CLI-and-parse-URL impls
(`plugin-channel-web/src/cloudflared.ts`, `…/ngrok.ts`, `plugin-webhooks/src/tunnel.ts`),
the last rolling its own `startTunnel()` outside the `TunnelProviderDef` contract.
**Fix:** hoisted a single `spawnCliTunnel({cmd,args,urlRegex,timeoutMs?,name?})` +
`isCliTunnelAvailable(cmd)` into `@moxxy/sdk` (`sdk/src/tunnel.ts`, where
`TunnelProviderDef` lives) — it owns the spawn → parse-URL → resolve/reject lifecycle
**and** the no-orphan child cleanup (the per-process `exit`/`SIGINT`/`SIGTERM` kill hook,
moved out of channel-web's deleted `child-cleanup.ts`). cloudflared/ngrok are now thin
configs over it. webhooks now expresses cloudflared+ngrok as registered
`TunnelProviderDef`s (`webhookTunnelProviders`) over the shared helper; `startTunnel` and
`isTunnelCliAvailable` delegate to the provider contract (`startTunnel` keeps the
per-call `urlTimeoutMs` override the contract's `open(opts)` can't carry). Same URLs
parsed, same teardown/`pid`/`stop` surface. +7 SDK tunnel tests (resolve / stderr-parse /
exit / spawn-error / timeout-kill / availability), +3 webhooks tunnel tests; existing
cloudflared/ngrok provider tests unchanged and green.

### 5. Finish MoxxyError adoption / HTTP-status classification — ✅ FIXED (2026-06-10)
**Cross-cut 1.7, 1.13, 2.6.** `classifyHttpStatus` exists (`sdk/src/errors.ts:255`) and is
applied across oauth token-exchange, device-flow, and the stt/provider packages. The
remaining high-signal user-facing throws are now migrated to `MoxxyError`:
- oauth input validation (`plugin-oauth/src/tools.ts`): missing `deviceUrl`/`authUrl` now
  throw `MoxxyError{code:'TOOL_ERROR'}`.
- vault config-resolution: `placeholder.ts` missing `${vault:NAME}` →
  `CONFIG_INVALID` (with a `/vault set` hint); `index.ts` `vault_get` not-found →
  `TOOL_ERROR`; `store.ts` unsupported vault-file version/kdf → `VAULT_CORRUPT`.
- Left as plain `Error` per the journal's own guidance: `store.ts`'s `'vault not open'`
  internal invariants (programming errors, not user-facing) and the mcp/browser/registry
  internal throws (B6/B7 below).
- Tests assert the code/shape: placeholder `CONFIG_INVALID`+context, store `VAULT_CORRUPT`,
  oauth_authorize `TOOL_ERROR` for both missing-URL branches.
- ~~desktop self-update **security** failures (signature/hash/unsafe-path) throw raw Error —
  `desktop-host/src/app-update/stager.ts`; candidates for a typed error code.~~ **RETIRED
  2026-06-09 (won't-fix by design).** `app-update/*` is intentionally dependency-free (node
  built-ins only) so it can be baked verbatim into the immutable bootstrap — importing the
  SDK error types there would break that constraint. The throw *messages* are already
  surfaced to the renderer as `error` strings, and the new boot-log now records a structured
  reject **reason** per gate (see #9), which covers the diagnosability this bullet was after.

---

## P3 — Low / per-package nits

### 0. Keep the Claude skill library current — STANDING
**Added 2026-06-10.** `.claude/skills/` (28 thin task checklists + index) and the
hooks in `.claude/settings.json` encode repo conventions and audit lessons; like
this journal, they rot silently — when a convention, command, extension point, or
invariant they reference changes, update the matching SKILL.md in the same PR.

### 6. plugin-memory caches embeddings via a parallel `EmbeddingIndex` — OPEN (won't-swap; re-assessed 2026-06-10)
**Cross-cut 1.11.** `plugin-memory` uses its own `EmbeddingIndex`
(`embedding-cache.ts`) instead of the SDK `CachedEmbeddingProvider`. **Re-assessed under
the round-3 drawdown and confirmed NOT a safe mechanical swap** — the two caches solve
overlapping but materially different problems:
- **Keying + bounding.** `EmbeddingIndex` keys by memory **name** (+ body-hash) and
  `prune(currentNames)` drops vectors for forgotten/renamed memories every recall, so the
  on-disk cache stays bounded. `CachedEmbeddingProvider` is **content-hash keyed with no
  prune** — swapping it in would grow the cache unboundedly on the recall hot path and lose
  the forget/rename eviction.
- **Persistence + invalidation.** `EmbeddingIndex` owns the `<dir>/.embeddings.json` format
  with embedder-name + dim invalidation in `load()`. `CachedEmbeddingProvider` is in-memory
  only (`serialize`/`hydrate`), so the store would have to re-implement the disk
  read/write/version/dim-guard layer around it anyway — no net dedup.
- **Concurrency.** The load→lookup→set→prune→flush cycle runs inside the store's write mutex
  (`store/search.ts:recallVector`) to race-protect concurrent recalls and `forget()`'s
  rebuild. A naive `CachedEmbeddingProvider.embed()` swap loses that explicit cycle.
**Decision:** LEAVE as-is. Real risk (unbounded growth + lost prune/flush ordering) for low
value (the dedup is partial at best). Revisit only if `EmbeddingIndex` is being reworked for
another reason.

### 7. Channel→core prod dependency — OPEN
`plugin-cli`/`plugin-telegram` keep real `@moxxy/core` prod imports (`savePreferences`,
`clearUsageStats`, `newTurnId`, `loadUsageStats`, `PermissionEngine` — e.g.
`plugin-cli/src/session/run-slash.ts:2`, `plugin-telegram/src/channel/turn-runner.ts:2`).
To fully sever channel→core, hoist these provider-neutral helpers into `@moxxy/sdk`
(cross-cut 2.14). (`plugin-subagents`/`plugin-view` keep core as a **dev**Dep only — their
`*.test.ts` import core; correct, leave them.)

### 8. Small casts / hardcoded values — ✅ FIXED (2026-06-10)
- **Type the exec allowlist — DONE.** `CapabilitySpec.commands` is now declared
  (`sdk/src/isolation.ts:40`), so `plugin-security/src/broker.ts` reads `caps.commands`
  directly — the `(caps as unknown as { commands? })` cast on the security exec-allowlist
  path is gone. (The journal's earlier "untyped on CapabilitySpec" note was stale once the
  field landed.)
- **Anthropic SDK casts — TIGHTENED.** `plugin-provider-anthropic/src/provider.ts`: the
  `countTokens` shim no longer casts `this.client.messages` through `unknown` (the method
  is fully typed on the SDK); `requestBody` is now typed `MessageStreamParams` and
  `streamOnce` takes that type instead of `Record<string,unknown>` (dropping the blanket
  `as unknown as Parameters<…>` double-cast). The residual casts are **narrow**, commented,
  and unavoidable: our hand-rolled message/tool shapes carry `media_type: string`, which
  the SDK narrows to a literal union — so `messages`/`tools`/`system` get a single
  `as MessageStreamParams[...]` / `MessageCountTokensParams[...]` cast each, not a blanket
  one. Inherited cleanly by the claude-code provider.
- **Hardcoded model descriptors — KEPT, values corrected.** Deriving the catalog from the
  Models API is a larger change (auth + caching) — deliberately still hardcoded
  (`provider.ts`, re-exported to `plugin-provider-claude-code/src/index.ts`). But the
  values were stale: opus-4-7 and sonnet-4-6 carry a **1M** context window (were 800k/200k)
  and `maxOutputTokens` were a flat 8000 (now 128k opus / 64k sonnet+haiku); haiku-4-5 stays
  200k. Verified against the current Anthropic catalog; a comment marks the hardcoding as
  intentional + the deferral.

### 9. Desktop self-update "downloads but reverts" — ROOT-CAUSED + FIXED, pending on-build verify
**Found + fixed 2026-06-09.** Root-caused from the on-disk state on a real failing machine
(no boot-log needed): in `<userData>/app/`, `bad.json` had poisoned **every** staged version
(0.0.19/0.0.25/0.0.28/0.0.29) and `confirmed.json` had **never** existed — even 0.0.28, which
runs fine *as the installed floor*, was poisoned when run as an override. So the bug was the
**confirm step**: the boot-probe required the renderer's `app.appBooted` IPC heartbeat to land
within 15s, and in packaged builds that heartbeat doesn't reliably land → the probe poisoned
healthy bundles → self-update never stuck. **Fix:** `armBootProbe` now confirms from the MAIN
process by polling the renderer DOM (`index.html` ships a static `#splash-fallback` inside
`#root` that React replaces on mount — so "splash-fallback gone" is a renderer-cooperation-free
health signal); the IPC heartbeat is kept only as a fast path. Plus the observability from this
pass (boot-log, reject reasons, `app.updateDiagnostics` + Diagnostics UI). **Remaining:** verify
on a real two-version update that 0.0.30+ now sticks (the fix lives in the *override's* main, so
a user on the broken 0.0.28 floor recovers simply by updating to a fixed release). Once verified,
consider dropping the now-redundant renderer-heartbeat path. **Severity med** (needs a build to close).

**2026-06-11 third failure mode found + fixed:** a release that bumps `RUNNER_PROTOCOL_VERSION`
hot-staged fine but was refused at boot by the lockstep gate (`runner-protocol-skew`) — the stager
never checked the gate, so the UI said "updated, relaunch" and every boot silently fell to the
floor (observed live on 0.4.2→0.4.3). Stage-time now enforces the same gate via
`exceedsCliRunnerProtocol` and reports **requires-full-update** (release-page CTA); Diagnostics
renders boot-log reject reasons in plain language. Same pass: `bootstrap.ts boot()` now clears
`MOXXY_APP_BUNDLE_ROOT/VERSION` up front — they survive `app.relaunch()`, so a floor boot after a
refused override impersonated the previous override and let the boot probe confirm/poison a bundle
that wasn't running. Residual (low): any pre-be7d33a floor will show the macOS Dock ghost-runner
whenever a refused update drops onto it — immutable floor code, only a full reinstall fixes it.

**2026-06-12 Tier-2 is now self-service:** the "needs the full app installer" dead end
(banner → release page → manual download/install) became one click: new `app.updateShell`
IPC + `installFullAppUpdate` (shell-updater.ts) drive electron-updater against a **generic
feed pinned at the exact `desktop-v<version>` release assets** — NOT GitHub latest/atom
discovery, which can't parse `desktop-v*` tags (semver-invalid with the prefix) and is
broken by npm-package releases anyway; this is also why the background
`checkForUpdatesAndNotify` in `initShellUpdater` likely never found anything (left as-is,
harmless). macOS gains a `zip` build target (Squirrel.Mac can't install from a dmg) and
needs a signed build — on signature/asset failure the IPC returns the error and the UI
falls back to the release page. Desktop releases stop taking the repo's "Latest" badge
(`make_latest: false` in release.yml). Residual: installers/feeds are draft-gated, so
`app.updateShell` 404s until the release is published (same as Tier-1); the zip only
exists on releases built after this change.

**2026-06-12 fourth failure mode found + fixed (the inverse of #3):** a STALE override
outranked a freshly installed shell. The resolve gate had no floor-version check, so after
"0.7.0 updates the bundled runner — install the full app update" → user installs 0.7.0,
the new shell still booted the staged 0.6.x override (signature/ABI/protocol gates all pass
for an OLD bundle) — whose update UI then re-demanded the full installer forever. Observed
live as "installed 0.7 but it still gets 0.6". `resolveActiveBundleDetailed` now takes
`floorVersion` (bootstrap passes `app.getVersion()`; shell version == floor bundle version)
and rejects `older-than-floor` (equal loses too — the baked copy is the trusted one); the
bootstrap clears the active pointer on that reject (no poison — the bundle is obsolete, not
broken) so later boots take the clean `no-active` path.

**Multi-session testing caveat (2026-06-11):** desks now hold N sessions and the runner pool is
keyed by session id, but every v1-migrated/first session has id === desk id — which masks
pool-key regressions. Always test multi-session paths with a desk's *second* (UUID-keyed) session.
Related accepted behavior: `desks.remove` stops session runners but leaves their session JSONL +
chat NDJSON on disk (pre-existing parity, now per-session); sessions spawn eagerly and background
runners stay alive (consider lazy spawn + idle-stop).

### 10. Shared-client extraction + WebSocket bridge — follow-ups — ⚠️ PARTIALLY DONE
**Introduced 2026-06-09** by the cross-platform client work (new `@moxxy/client-core`,
`@moxxy/client-platform-web`, `@moxxy/client-transport-ws`, `@moxxy/ipc-server-ws`,
`@moxxy/design-tokens`, `@moxxy/plugin-channel-mobile`; `apps/mobile` Expo PoC).
- **Two session-mutation surfaces in client-core** (logged 2026-06-11, sidebar-tree
  redesign): `desksStore` now carries desk-scoped session ops
  (createSession/setActiveSession/renameSession/removeSession — the sidebar tree spans
  every desk) while `sessionsStore` (`useSessions`) keeps the same mutations scoped to
  one tracked desk. The desktop no longer uses `useSessions` (kept for mobile/API
  parity); consolidate to one surface — likely fold the tracked-desk store into thin
  selectors over `desksStore` — next time either file is touched. Note the optimistic
  connection-flip logic is duplicated across both `setActive*` paths.
- ~~**`apps/desktop/src/lib/*` transition shims.**~~ **RETIRED 2026-06-09:** all ~46
  components now import `@moxxy/client-core` (and `@moxxy/client-platform-web` for TTS)
  directly; `lib/` is just `asset.ts` (Vite-specific) + `boot.ts` (the boot shim).
- ~~**Headless WS serving was window-bound.**~~ **ADDRESSED 2026-06-09:** the new
  `mobile` channel (`@moxxy/plugin-channel-mobile`) serves the bridge headlessly from a
  *single session* via `MobileSessionHost` — `moxxy mobile` and `moxxy serve --all` run it
  with no `BrowserWindow`. The *desktop* bridge is still window-bound (its `SessionDriver`s
  are created by `bindWindow`); decouple that only if a headless desktop-host is needed.
- **`@moxxy/design-tokens` ships a `generateRootCss` the desktop doesn't consume yet** —
  `styles.css`'s `:root` stays the source of truth (zero visual risk). Parity is
  snapshot-tested; a later change can flip `styles.css` to inject the generated block.
- ~~**Mobile capabilities are no-ops in the PoC.**~~ **SUPERSEDED 2026-06-10 (full app
  port):** `apps/mobile` is no longer a PoC — the mobile-plugin design landed on the shared
  architecture (expo-router + NativeWind, 28 components, useGatewayStore facade over
  client-core, MobileSessionHost extensions). Platform access deliberately lives in the
  app's own Expo hooks (image/document picker, clipboard, secure-store, expo-audio), NOT
  client-core's platform registry — the registry's `AudioCapture` contract is a web-shaped
  PCM16@24kHz pipeline that doesn't fit shipping a platform-native compressed clip to the
  host transcriber. Reconcile the contract (or add a clip-based capability) if a second
  native platform ever appears.
- **Mobile-port residue (2026-06-10, low):** (a) the bearer-subprotocol encoder is
  mirrored in `apps/mobile/src/hooks/useGatewaySocket.ts` (WsRpcClient needed a
  close-on-replace lifecycle `makeWsApi` doesn't expose — same mirroring convention
  client-transport-ws uses vs the SDK; converge if a third copy appears); (b) sending
  attachments while a turn is in flight is refused with a visible error (inline payloads
  can't ride client-core's path-based queue) — queue inline attachments host-side if this
  bites; (c) `pairing.loadPairing` is a documented no-op (the WS bridge has no
  pairing-code endpoint; the QR/`?t=` URL IS the pairing flow).
- ~~**Desktop bridge had no UI — only env-gated boot (`MOXXY_WS_BRIDGE=1`).**~~
  **ADDRESSED 2026-06-10:** Settings → **Mobile** tab now starts/stops the bridge at
  runtime (`MobileGatewayManager` in `electron/main/ws-bridge.ts` + `mobileGateway.*` IPC,
  host-only), persists the on/off preference, renders the pairing QR (its `connectUrl` is
  round-trip-tested through the shipped app's `parsePairingQrPayload`), and rotates the
  token. **Follow-up (low):** it only does LAN pairing (binds `0.0.0.0` and advertises the
  LAN IP) — tunnel-based REMOTE pairing (cloudflared/ngrok via the mobile channel's
  `tunnelProviderFor`, so a phone off the local network can connect) is not wired into the
  desktop tab yet; add a tunnel picker + `buildConnectUrl({ tunnelUrl })` path when off-LAN
  pairing is needed.
**Severity low** (remaining items are opt-in / additive; desktop behavior unchanged).

### 11. Workflows engine ported + while-loop node + visual builder GUI — phases 1 & 2 DONE — low
**Introduced 2026-06-10** by the workflows-engine port. `@moxxy/plugin-workflows` now
carries the logic steps (`bridge`/`condition`/`switch`), `format: json|plain`, branch
fields, the persisted-only `ui.layout` schema, agentic YAML authoring (`workflow_create` +
`draft.ts`), LLM branch-predicate parsing, and `awaitInput` pause/resume (`run-store.ts`
checkpoints + executor `resumeWorkflowRun`, backed by core's new retained-session
`continue()`/`release()` in `subagents/run-child.ts` + `registry.ts`). It merged surgically
onto main's executor — **main's `MAX_NESTING_DEPTH` is preserved**, and the CLI's separate
`afterWorkflow` SCC/`MAX_AFTER_WORKFLOW_CHAIN` guard (A11, on the inter-workflow trigger
graph) is intact; the two operate on different graphs and don't conflict.
- **New `loop` node** (`{ body, condition, maxIterations: 1..50 }`): repeats body steps,
  gated by the same LLM `then`/`else` predicate as a `condition` step. **Two independent
  termination guards, both tested:** the per-loop iteration cap (temporal) and
  `MAX_NESTING_DEPTH` (structural) — a loop body that calls nested workflows still bottoms
  out at the depth cap, so no N×depth blow-up and no infinite loop is reachable. On cap it
  finishes with a "max iterations reached" note rather than hanging.
- **Phase 2 — visual builder GUI: DONE (2026-06-10).** New DOM-free, RN-safe shared model
  `@moxxy/workflows-builder` (canvas state + reducer, pure ops, a dependency-free
  Workflow↔YAML codec with auto-layout, and the validate/save error-mapping bridges; 32
  tests). Desktop: `apps/desktop/src/workflows/` upgraded `WorkflowsPanel` to a list↔builder
  switcher with a hand-rolled SVG drag-canvas (no react-flow — the graph is ≤40 nodes),
  color-coded node cards, derived `needs`/branch/loop edges, a node inspector, an add-node
  palette, live `validateDraft` decoration, and Save (7 panel tests). Mobile:
  `apps/mobile/app/workflow-edit.tsx` + `WorkflowEditor`/`useWorkflowEditor` over the same
  model and the mobile frame bridge. Shared `useWorkflowBuilder` in client-core drives the
  IPC for both. The **loop node's two-region model** (body membership + the single
  "on done / on error → next" exit edge) is shared, rendered, and round-trips through
  serialize↔hydrate. Expo iOS export verifies the shared model bundles RN-clean.
  **v1 descope:** the mobile builder is an OUTLINE editor (a node list with the same
  operations), not a touch-drag canvas — touch dragging a node graph was disproportionate
  for v1; revisit with `react-native-svg` + gesture-handler if a graphical mobile canvas is
  wanted.
- **Round-2 correctness pass (2026-06-10).** Eight audit findings fixed:
  - **`awaitInput` human-in-the-loop SHIPPED — gate REMOVED (2026-06-10).** The resume path
    now lives on main, so the validate/save gate from #146 is gone. `awaitInput: true` is
    accepted again on **prompt/skill steps only** (rejected on tool/workflow/logic/loop steps
    and on a loop body — the executor has no interactive child / no mid-iteration checkpoint
    there); `draft.ts` teaches it again with a worked example. The resume RPC is additive
    **protocol v5** (`workflow.resume`, `MIN_COMPATIBLE` unchanged at 1): `RunnerMethod` +
    server handler → `session.workflows.resume(runId, reply)`; `WorkflowsView.resume` (SDK) +
    CLI impl (`resumeNow` → existing `resumeWorkflowRun`); `RemoteSession.workflows.resume`
    gated on server proto ≥ 5 with the "update the CLI" message (mirrors the v4 builder gate);
    desktop-ipc-contract `workflows.resume` + desktop-host + MobileSessionHost handlers; and a
    `workflows.resume` entry on `REMOTE_ALLOWED_COMMANDS` (RESPOND-only — answering a question
    the WORKFLOW asked, like `ask.respond`; it can't author). The `workflow_paused` event now
    carries the workflow name + step label + the question so the operator UI is self-contained.
    **Reply UI:** desktop (`apps/desktop/src/workflows/PausedWorkflows.tsx` via the new
    client-core `usePausedWorkflows` hook — a card with a reply box that dispatches
    `workflows.resume`) and TUI (`plugin-cli` `WorkflowsPanel` switches to inline reply capture
    when `view.run` returns `status: 'paused'`). The non-terminal-`paused` handling in `runNow`
    is kept (and the resume side delivers the now-completed run to the inbox); the stale-checkpoint
    sweeper + `clearRetainedChildren()`-on-shutdown from #146 are kept. Vars set before a pause
    now survive the checkpoint round-trip (Finding 4, below) so downstream `{{ vars.* }}` render.
    **Remaining edges (honest):** (1) the **mobile** UI is bridge-wired (handler + allow-list +
    contract, Expo-bundled) but has **no paused-workflow card yet** — a mobile user can reach
    `workflows.resume` over the frame bridge, but the screen doesn't surface the pending question
    yet; add a paused card to `apps/mobile`. (2) **Multi-pause** workflows (several awaitInput
    steps) work — resume re-pauses and the UI re-prompts — but each pause writes a fresh checkpoint;
    not stress-tested beyond two pauses. (3) **Concurrent paused runs** of the SAME workflow each
    get a distinct `runId`/checkpoint and surface as separate cards; the retained-child registry
    is keyed by child session id so they don't collide, but the desktop card list isn't ordered
    or de-duped beyond run id. (4) Resume relies on the **retained child still being in the
    runner process's in-memory registry** — a runner restart between pause and resume loses it
    (the checkpoint survives, but `spawner.continue` then fails cleanly rather than resuming);
    persisting/rehydrating the child across restarts is future work.
  - **Desktop builder IPC now works over the runner (was Finding 2 — real).** The desktop
    drives a `RemoteSession`, whose workflows view only exposed `list/setEnabled/run` — so
    `validateDraft`/`save`/`getRun` were `undefined` and the builder threw "not supported on
    this session". Added a `workflow.validateDraft|save|getRun` RunnerMethod family
    (**protocol bumped to v4**) + RemoteSession client methods + server handlers; the desktop
    builder validates/saves/loads against the runner now. Tested in `runner/integration.test.ts`.
  - **Loop-body validation (Findings 3/5/8):** a condition/switch step used as a loop body
    is rejected (its branch routing was silently ignored); a NON-body step that `needs` a
    loop-body step is rejected (it would stall — body steps are excluded from the main DAG);
    a loop-body step's own `when` and any `needs` other than its loop step / a sibling body
    step are rejected (body steps run unconditionally each iteration).
  - **Checkpoint vars (Finding 4):** the checkpoint persists+restores `vars` so a logic step
    that ran before a pause isn't dropped on resume — now LIVE (the resume path shipped), and
    proven by the end-to-end executor test (a `bridge` sets `vars.channel`, the run pauses,
    resume restores it and a downstream `{{ vars.channel }}` renders).
  - **Prototype-pollution guard (Finding 6):** model-provided logic-step `vars` skip
    `__proto__`/`constructor`/`prototype` keys when merging.
  - **Rename cleanup (Finding 7):** `WorkflowStore.save(workflow, previousName)` removes the
    old file/entry on rename (threaded through `WorkflowsView.save` → desktop IPC → runner
    RPC → builder hook), so renaming no longer leaves an orphaned duplicate.
- **Remaining notes:** (a) loop body steps are excluded from the main DAG scheduler via a
  `loopBodyIds` set; if a future feature needs a step to be both a loop body AND independently
  scheduled, that exclusion must be revisited. (b) awaitInput is barred inside a loop body
  (would need mid-iteration checkpointing) — orthogonal to the now-shipped resume path; lift
  only if a use-case appears.
- **Builder UX pass (2026-06-10):** the inspector's skill/tool name fields are now pickers
  fed by a live `session.info` registry snapshot (new client-core `useActionCatalog`,
  refresh on `SESSION_INFO_REFRESH_EVENT`): dropdown of what's actually registered, explicit
  "(not installed)" option preserving a saved-but-removed name, an explicit empty-state
  message when the session has no skills/tools, and a free-text fallback when no session is
  attached. The NodeCard shorthand/per-side border-color React warning is gone (per-side
  colors via `edgeColor()`). **Remaining:** (a) the `workflow` step's name field is still
  free text — populate it from `workflows.list` the same way; (b) the MOBILE outline editor
  (`WorkflowEditor`) still has free-text name fields — `useActionCatalog` is client-core and
  `session.info` is on `REMOTE_ALLOWED_COMMANDS`, so wiring it is mechanical.
- **Shell/canvas UX pass 2 (2026-06-10):** the three desktop sections share one 64px header
  (`apps/desktop/src/shell/ViewHeader.tsx` — `ViewHeader` + `Segmented` + a Chat|Workflows
  `ViewSwitcher` leading every header); the sidebar's MENU group is gone (lone Settings entry;
  picking a workspace returns to chat so Settings isn't a dead end); the settings tabs moved
  into the fixed header (right-aligned, Refresh button dropped — `useSettings` fetches on
  mount). The builder canvas zooms 40–200% (corner −/％/+ cluster + pinch/ctrl-wheel anchored
  at the cursor; pointer math normalised into pre-zoom canvas coords). **Debt note:** the
  settings error banner lost its only manual retry when the Refresh button went — if a
  transient `settings.read` failure proves common, add a retry affordance to the error row.
- **Builder UX pass 3 (2026-06-10):** canvas drag-to-pan (background drag scrolls the
  surface; a pan that moved suppresses the follow-up deselect click — node drag / connection
  drag / edge-✕ are untouched since they stopPropagation), builder-header controls (Back /
  validity badge / Save) aligned to the input row via flex-end + a shared `CONTROL_H`
  matching TextInput, and plugin-workflows `formatIssues` now emits step-anchored plain
  English (`step "greet": prompt must not be empty`) instead of zod-speak — which also makes
  raw schema errors bucket onto the offending node via `mapErrorsToNodes` (they previously
  only hit the generic banner, e.g. `steps.0.prompt: String must contain at least 1
  character(s)`).

### 12. CLI `service install` units break under an Electron-as-node CLI — OPEN
**Introduced/observed 2026-06-10** while root-causing the desktop Dock-ghost runner (fixed
in desktop-host the same day — see ledger). `cli/src/commands/service/common.ts` `nodeBin()`
returns `process.execPath` as the unit's `<node>`. When the CLI itself runs under the
packaged desktop's Electron-as-node (the desktop spawns the bundled CLI that way — e.g. an
agent running `moxxy service install` / `moxxy schedule daemon --background` from a desktop
session), the launchd/systemd unit's ExecStart becomes the **Electron app binary** and the
rendered unit env (`launchd.ts renderPlist` — PATH + spec.env only) has **no
`ELECTRON_RUN_AS_NODE=1`**: the "daemon" boots a full GUI app instance at login
(RunAtLoad+KeepAlive), i.e. a permanent Dock ghost that never runs the CLI. Fix shape:
`nodeBin()` should detect run-as-node (env `ELECTRON_RUN_AS_NODE` present) and (a) export
`ELECTRON_RUN_AS_NODE=1` into the unit env, and (b) on macOS prefer the bundle's
`<App> Helper` binary (mirror desktop-host's `electronNodeBinary()` — the MAIN bundle
executable registers a Foreground LaunchServices entry/Dock icon even WITH the env var on
macOS 26) — or better, resolve a real `node` from PATH for the unit and only fall back to
the Electron binary. Low blast radius today (services are normally installed from a real
terminal CLI), but silently wrong when it happens.

### 13. `@moxxy/sdk` barrel re-exports node-only code → browser/RN bundles break — OPEN (partially mitigated)
**Observed 2026-06-17** building the cross-channel file-diff preview. The `@moxxy/sdk`
index barrel re-exports node-coupled modules (e.g. `tunnel.js` → `node:child_process` via
`spawnCliTunnel`), so ANY browser/React-Native consumer that imports a **runtime value**
from `@moxxy/sdk` pulls those built-ins and fails to bundle: the desktop vite renderer
errored `"spawn" is not exported by "__vite-browser-external"`, and Metro would hit the
same. Type-only imports are fine (erased); the trap is value imports (here the pure diff
helpers `toDiffRows`/`fileDiffSummary`/`isFileDiffDisplay`/…). Mitigated for this feature
by adding a **dependency-free `@moxxy/sdk/tool-display` subpath export** and importing the
helpers from there in chat-model/desktop/mobile. But the trap recurs every time a new pure
SDK helper is needed by a renderer. Fix shape: either split the SDK into a browser-safe
pure core entry + a node-only entry, or systematically expose each pure leaf module as its
own subpath export (and lint/forbid renderer code importing the barrel for values). Low
blast radius today (one-off per helper) but a sharp edge for every future shared helper.

---

## Resolved ledger (verified still in place 2026-06-08)

Collapsed from full write-ups; each was re-checked against `HEAD` and confirmed — no
regressions. Restore the detail from git history (`TECH_DEBT.md` @ `b014c3a`) if needed.

- **Packaged Clerk sign-in: OAuth is a top-frame redirect, not a popup** (2026-06-11).
  First real packaged sign-in attempt: "Continue with Google" spun forever — clerk-js's
  prebuilt modal navigates the TOP FRAME to the provider, and `lockDownNavigation`'s
  blanket deny swallowed it silently (the popup-based `setWindowOpenHandler` path was
  never exercised). `lockDownNavigation` now takes `allowOriginPatterns` (main window:
  OAUTH_HOST_PATTERNS + its own loopback serving origins for the return leg — the
  FAPI→app hop is not same-origin with the mid-flow page; focus window keeps the blanket
  deny) + `challenges.cloudflare.com` added to CSP connect-src for the sign-up Turnstile.
  Postscript in `docs/desktop-clerk-loopback-subdomain.md`. The real round-trip verify
  then surfaced the next layer (below).
- **Packaged Clerk sign-in: NEW users were never created** (2026-06-11). The real
  Google round-trip worked for existing users only — a new user got "External account
  not found" and no account. Cause: the modal's OAuth callback returns to the hosted
  Account Portal (`accounts.<domain>/sign-in#/sso-callback`), where client JS performs
  the sign-in→sign-up "transfer" (`signUp.create({ transfer: true })`) for unknown
  accounts — and `installAccountPortalRecovery` yanked the window off that page on
  `did-navigate`, before the transfer could run (existing users survived because their
  session is set server-side during the FAPI leg). Fixed twice over: the recovery net
  now skips the portal's functional `/sign-in` + `/sign-up` paths (only `/user` etc.
  recover), and the renderer's `OAuthTransferBridge` (apps/desktop/src/lib/oauthTransfer.tsx)
  sweeps any still-dangling transferable attempt on boot and completes it in-app.
  Instance config verified sane via the public FAPI `/v1/environment` (sign-up mode
  `public` on dev + prod). **Third layer found live 2026-06-12:** the fresh-sign-up
  round-trip still stranded the window — on the portal's *profile* page this time. The
  portal is an SPA: its post-transfer hop from `/sign-in#/sso-callback` to `/user` is a
  client-side router push, and the recovery net only listened to `did-navigate` (never
  fired). Net now also watches `did-navigate-in-page`, plus a 30s watchdog on the
  automatic `#/sso-callback` leg (interactive portal pages get NO timer) so a dead
  transfer page recovers into the app, where the boot sweep finishes the sign-up — no
  restart. **Remaining verify:** packaged round-trip with a never-seen-before Google
  account.
- **Desktop Dock-ghost runner process** (2026-06-10). The packaged desktop's runner
  (`moxxy serve`, spawned via the bundled CLI with `ELECTRON_RUN_AS_NODE=1`) showed up in
  the macOS Dock as a generic-executable ("exec") icon named after the app: on macOS 26
  ANY launch of the MAIN bundle executable registers a Foreground LaunchServices entry,
  run-as-node or not (verified empirically with a probe). `nodeLauncher()`
  (`desktop-host/src/cli-resolver.ts`) now routes run-as-node children through the
  `<App> Helper.app` binary (`electronNodeBinary()` — `LSUIElement=true` → registers as
  UIElement, no Dock presence; same framework, Node runs identically; falls back to
  execPath when no helper). The CLI-side cousin is OPEN as P3 #12.
- **Mode loop scaffolding hoisted to the SDK** (2026-06-08, PR #108, was P2 #6). The
  load-bearing stuck-loop orphan-result fix + the tool-batch abort path were copy-pasted
  across `mode-default` and `mode-goal` (a fix to one had to be hand-mirrored). Both now
  compose `executeToolUses` + `emitRequestsAndDetectStuck` from `@moxxy/sdk`
  (`tool-dispatch.ts`), parameterized by a `StuckLoopReport` for each mode's wording +
  goal's `goal_stuck` event. Pure refactor, no behavior change; mode-default 9/9 +
  mode-goal 10/10 green. (The outer loop bodies stay per-mode by design — different
  strategies; the residual near-identical overflow/reactive-compaction + provider-bookend
  blocks are noted as low in the 2026-06-09 audit.)
- **plugins-admin CLI install hardening + dedup** (2026-06-08, was P2 #7/#8). The imperative
  `installPluginPackage`/`removePluginPackage` now reject a flag-like spec via
  `assertSafeNpmSpec` (a leading `-` is argument injection) — and crucially still accept the
  git/path specs the original "just apply `NPM_NAME_RE`" idea would have broken. `NPM_NAME_RE`,
  `diffSnapshot`, and `PluginSnapshot` are hoisted into `plugin-plugins-admin/src/shared.ts`
  (no more `install.ts`/`toggle.ts` copy-paste). +9 tests.
- **Security tests for zero-coverage paths** (vault keysource/canary, mcp admin ×6, the
  tool↔result pairing guard). The pairing test moved to `chat-model/src/pair-events.test.ts`.
- **RFC 8628 device-flow dedup** → `plugin-oauth/src/oauth/device-flow-shared.ts`.
- **Plugin `version` stamped from the manifest** in `PluginLoader.load` (`core/src/plugins/loader.ts:57`).
- **Embedders & isolators are first-class swappable blocks** (`EmbedderRegistry` +
  `defineEmbedder`; `IsolatorRegistry`/`ContributedIsolatorRegistry` + `session.isolators`).
- **`TOOL_ERROR` + `ABORTED` `MoxxyErrorCode`s** (`sdk/src/errors.ts:53-54`).
- **`runSingleShotTurn` SDK helper** used by `mode-deep-research`.
- **Zod-validated persisted-config reads** in provider-admin, mcp, channel-web tunnel-settings.
- **Model-scoped transformers embedder name** (`transformers:<model>`).

---

## Reasoning + sub-agent-groups intake (2026-06-17)

Logged while shipping visible per-provider reasoning + the grouped sub-agents view. Reviewed the
provider stream parsers, `chat-model` projection, and the subagent event bridge in passing.

- **R1 — built-in reasoning config isn't wired live to the runner from the desktop.** The functional
  path is `config.context.reasoning` (CLI + the desktop's runner read it). The desktop Settings →
  Providers reasoning-effort control persists to local state only with a `TODO`; making it live needs
  a typed `DesktopPrefs.reasoning` + `ProviderEntry.supportsReasoning` in `@moxxy/desktop-ipc-contract`
  and a runner config-apply step. Until then the desktop control stays hidden (no row reports
  `supportsReasoning`). `apps/desktop/src/settings/ProvidersTab.tsx`.
- **R2 — reasoning config is session-level, not per-provider-granular.** `session.reasoning` is one
  value applied to whichever provider is active (gated by `supportsReasoning`), not a per-provider
  map. Good enough for one PR ("only supporting providers honor it"); a true `{ [provider]: effort }`
  map is the follow-up. `packages/core/src/session.ts`, `cli/src/config-applier.ts`.
- **R3 — Codex/OpenAI reasoning isn't round-tripped.** Codex captures `encrypted_content` into the
  `reasoning_message` event (and the log), but `toResponsesInput` drops the `reasoning` block rather
  than replaying it as a `reasoning` input item; OpenAI Chat Completions can't accept reasoning back at
  all. Display works; reasoning continuity across turns is deferred. Only Anthropic round-trips today.
- **R4 — Anthropic multi-block thinking collapses to one round-trip block.** A single provider call
  with multiple interleaved `thinking` blocks is captured as one accumulated block carrying the last
  signature. Correct for the common single-block case; multi-block could mis-validate on replay.
  `packages/plugin-provider-anthropic/src/provider.ts` (`streamOnce`).
- **R5 — sub-agent grouping lives in the shared `pair-events` fold; tool grouping lives in client-core
  (`groupToolNodes`).** Intentional (the TUI has no render-node layer), but the two grouping homes are
  a candidate to unify. Nested grandchild agents render as additional groups, not a recursive tree (out
  of scope). The standalone `SubagentView`/`SubagentScopeView` now duplicate the group's per-agent row —
  collapse standalone into a group-of-one later.

---

## Blocked items (fix agents declined to do mechanically — sound calls)

- **B6.** mcp `wrap.ts` `throw new Error('aborted')` ×3 — internal abort control-flow, not
  user-facing; left as-is.
- **B7.** browser sidecar-internal throws + `new Error(String(err))` normalizers — errors
  cross JSON-RPC as strings; no user-facing code value. → folded into P2 #5.

---

*Original per-package reports + cross-cut themes came from the audit workflow
(`.claude/wf-quality-audit.js`); the fix sweep is `.claude/wf-apply-fixes.js`.*
