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
- **A13 [high, PoC-scoped] default `moxxy mobile` prints an unconnectable QR** — ✅ FIXED
  (this PR): the QR now advertises exactly what is bound (loopback default →
  `ws://127.0.0.1` + a printed hint that a real phone needs `MOXXY_MOBILE_HOST`/`bindHost`
  opt-in or a tunnel; wildcard bind → LAN IP; tunnel path unchanged), keeping the
  loopback-by-default security posture; `apps/mobile/README.md` updated to match.

---

## P1 — High

### 1. Runner/thin-client: retype channel handlers to the SDK contract — ⚠️ PARTIALLY DONE
**Findings:** plugin-cli #4, plugin-telegram #6, cross-cut 2.4 (all **high**).
**Done:** `CredentialResolver`, `McpAdminView`/`McpServerStatusView` live on `@moxxy/sdk`;
`SessionLike` carries optional `readyProviders?`/`credentialResolver?`/`mcpAdmin?`
(`packages/sdk/src/session-like.ts:245-249`). The cli handlers now import
`ClientSession as Session` from `@moxxy/sdk` and read the capabilities through optional
chaining (`plugin-cli/src/.../picker-handlers.ts`, `use-mcp-status.ts`, `run-slash.ts`).
**Remaining (deferred — the genuine coupling):** `ClientSession` still exposes the full
concrete registry surface (providers/modes/tools/commands/…), so the handlers would not
yet compile against a bare `RemoteSession`. Retype the handler params to the minimal
`SessionLike` slice they actually use and verify graceful degradation when a
`RemoteSession` leaves a capability undefined. Do this alongside the runner/thin-client
work, not standalone. (The `RemoteSession` casts at `desktop-host/src/ipc/session.ts:105`
and `ipc/shared.ts:164` are the same seam — see P3.)

### 2. Desktop persists every conversation twice — pick one source of truth — ⚠️ PARTIALLY DONE
**Found 2026-06-08 (the "NDJSON-vs-replay redundancy" follow-up).** Every committed event
is written to disk in **two** independent stores:
- runner session log — `~/.moxxy/sessions/<id>.jsonl`, replayed in full on every attach
  (`runner/src/server.ts:184` — always replays from seq 0);
- desktop NDJSON chat-log — `~/.moxxy/chats/<workspaceId>.jsonl`
  (`desktop-host/src/chat-log.ts`), the renderer's windowed mirror.

**Fixed (2026-06-08, PR #107):** the **unbounded NDJSON growth** defect. Because the runner
replays the full history on every restart and the renderer re-appends each replayed event,
the NDJSON log used to grow by a complete copy of the conversation per restart — and since
`loadSegment`'s cursor is a line index, the doubled file also corrupted scroll-up
pagination. `appendEvents` is now **idempotent by event id** (lazy file-path-keyed id cache),
so the log holds one copy and its cursors stay stable. +5 chat-log tests.

**Remaining (the real decision):** the redundancy itself. The runner replay already
delivers the complete history on every attach, so the desktop NDJSON store is arguably
entirely redundant — dropping it (read history from the runner replay only) would also kill
the redundant on-restart append IPC and the `/new` desync below. Counter-risk: legacy
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

### 4. Unify tunnel subprocess management + make webhooks use `TunnelProviderDef` — OPEN
**Cross-cut 1.5.** Three near-identical spawn-CLI-and-parse-URL impls
(`plugin-channel-web/src/cloudflared.ts:19-70`, `…/ngrok.ts:19-70`,
`plugin-webhooks/src/tunnel.ts:50-98`); webhooks ignores the existing `TunnelProviderDef`
contract entirely and rolls its own `startTunnel()`. **Action:** hoist a
`spawnCliTunnel({cmd,args,urlRegex})` helper; make webhooks consume registered
`TunnelProviderDef`s.

### 5. Finish MoxxyError adoption / HTTP-status classification — OPEN (partial)
**Cross-cut 1.7, 1.13, 2.6.** `classifyHttpStatus` exists (`sdk/src/errors.ts:255`) and is
applied across oauth token-exchange, device-flow, and the stt/provider packages. Remaining
bare `throw new Error` worth migrating (small, high-signal — the bulk of the repo's other
raw throws are internal registry/broker invariants that should stay plain):
- oauth input/usage validation — `plugin-oauth/src/tools.ts:114,146`.
- vault config-resolution throws (user-facing) — `plugin-vault/src/placeholder.ts:20`,
  `index.ts:150`, `store.ts:164,186`.
- ~~desktop self-update **security** failures (signature/hash/unsafe-path) throw raw Error —
  `desktop-host/src/app-update/stager.ts`; candidates for a typed error code.~~ **RETIRED
  2026-06-09 (won't-fix by design).** `app-update/*` is intentionally dependency-free (node
  built-ins only) so it can be baked verbatim into the immutable bootstrap — importing the
  SDK error types there would break that constraint. The throw *messages* are already
  surfaced to the renderer as `error` strings, and the new boot-log now records a structured
  reject **reason** per gate (see #9), which covers the diagnosability this bullet was after.

---

## P3 — Low / per-package nits

### 6. plugin-memory caches embeddings via a parallel `EmbeddingIndex` — OPEN
**Cross-cut 1.11.** `plugin-memory/src/store.ts:6,88-96` still uses its own `EmbeddingIndex`
cache instead of the SDK `CachedEmbeddingProvider`. **Deferred:** now that the atomic-write +
recall-race bugs are fixed, this is pure dedup of caching logic over a subtle mutex-guarded
recall path — low value, real risk. Fold in only if the recall path is touched anyway.

### 7. Channel→core prod dependency — OPEN
`plugin-cli`/`plugin-telegram` keep real `@moxxy/core` prod imports (`savePreferences`,
`clearUsageStats`, `newTurnId`, `loadUsageStats`, `PermissionEngine` — e.g.
`plugin-cli/src/session/run-slash.ts:2`, `plugin-telegram/src/channel/turn-runner.ts:2`).
To fully sever channel→core, hoist these provider-neutral helpers into `@moxxy/sdk`
(cross-cut 2.14). (`plugin-subagents`/`plugin-view` keep core as a **dev**Dep only — their
`*.test.ts` import core; correct, leave them.)

### 8. Small casts / hardcoded values — NEW, low
- **Type the exec allowlist.** `plugin-security/src/broker.ts:343` reads
  `(caps as unknown as { commands? }).commands` — a forward-compat field not on
  `CapabilitySpec`. It gates the **exec allowlist**, so it's worth typing properly on
  `CapabilitySpec` to retire the cast on a security path.
- **Anthropic SDK casts.** `plugin-provider-anthropic/src/provider.ts:236,367` — a
  hand-rolled `requestBody: Record<string, unknown>` cast to the SDK's `stream` params, and
  a `countTokens` shim cast. Defeats compile-time checking on the request hot path;
  inherited by the claude-code provider.
- **Hardcoded model descriptors.** `plugin-provider-anthropic/src/provider.ts:51-55`
  hardcodes the model list (incl. `claude-opus-4-7` at 800k context) and re-exports it to
  `plugin-provider-claude-code/src/index.ts:11`, so the subscription provider inherits the
  API-key provider's model set verbatim. Drift-prone; should be derived/config.

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

### 10. Shared-client extraction + WebSocket bridge — follow-ups — ⚠️ PARTIALLY DONE
**Introduced 2026-06-09** by the cross-platform client work (new `@moxxy/client-core`,
`@moxxy/client-platform-web`, `@moxxy/client-transport-ws`, `@moxxy/ipc-server-ws`,
`@moxxy/design-tokens`, `@moxxy/plugin-channel-mobile`; `apps/mobile` Expo PoC).
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
- **Mobile capabilities are no-ops in the PoC.** `apps/mobile` registers `configurePlatform({})`
  — no voice/TTS/KV. A real build needs a `@moxxy/client-platform-expo` (Expo Audio/Speech/
  AsyncStorage) mirroring `@moxxy/client-platform-web`.
**Severity low** (remaining items are opt-in / additive; desktop behavior unchanged).

---

## Resolved ledger (verified still in place 2026-06-08)

Collapsed from full write-ups; each was re-checked against `HEAD` and confirmed — no
regressions. Restore the detail from git history (`TECH_DEBT.md` @ `b014c3a`) if needed.

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

## Blocked items (fix agents declined to do mechanically — sound calls)

- **B6.** mcp `wrap.ts` `throw new Error('aborted')` ×3 — internal abort control-flow, not
  user-facing; left as-is.
- **B7.** browser sidecar-internal throws + `new Error(String(err))` normalizers — errors
  cross JSON-RPC as strings; no user-facing code value. → folded into P2 #5.

---

*Original per-package reports + cross-cut themes came from the audit workflow
(`.claude/wf-quality-audit.js`); the fix sweep is `.claude/wf-apply-fixes.js`.*
