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

**Last refreshed:** 2026-06-09 — the "update flows" work (CLI `moxxy update` + TUI version
banner + desktop self-update observability) **retired the self-update typed-error sub-bullet
of P1 #5** (re-scoped as won't-fix-by-design — see it) and closed the long-standing
*silent* desktop fall-back-to-the-floor by adding a persisted boot-decision log; the one
remaining piece (confirming the runtime root cause on a packaged build) is logged as #10.

2026-06-08 — re-verified every open item against `HEAD` and folded
in findings from the desktop-resume / claude-code-provider / plugins-admin work that
landed after the original audit. All prior "✅ DONE" items were re-checked and confirmed
still in place (no regressions); they're collapsed into the ledger at the bottom. The same
pass also **retired the plugins-admin CLI install-hardening + dedup items** (former P2
#7/#8 — see the ledger) as the first chip-away under the new journal rule.

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

### 2. Desktop persists every conversation twice — pick one source of truth — 🔴 NEW
**Found 2026-06-08 (the "NDJSON-vs-replay redundancy" follow-up, now characterized).**
Every committed event is written to disk in **two** independent stores:
- runner session log — `~/.moxxy/sessions/<id>.jsonl`, replayed on attach
  (`runner/src/server.ts:184`; `desktop-host/src/runner-supervisor.ts:79,435`);
- desktop NDJSON chat-log — `~/.moxxy/chats/<workspaceId>.jsonl`
  (`desktop-host/src/chat-log.ts:30-33`), loaded by
  `apps/desktop/src/lib/chat-store/store.ts:187`.

Two concrete defects fall out of the redundancy:
- **Desync window on `/new`.** Reset wipes both via two separate IPC calls
  (`CommandPalette.tsx:91-92`: `chatStore.clear()` then `session.newSession`). If the
  second fails or the app dies between them, the renderer is cleared but the runner is
  still primed → old context resurrects on the next turn/restart.
- **Unbounded NDJSON growth.** On restart `seenIds` starts empty; the runner replays its
  full history on attach; each replayed event misses `seenIds`, so `dispatch` re-appends
  it to the NDJSON log (`store.ts:317-326`). `loadOlder` dedups only on read
  (`store.ts:240-243`), so the on-disk file bloats by a full copy every restart.

**Action:** decide the single source of truth. The runner already persists + replays the
full history, so the desktop NDJSON store is arguably entirely redundant — either drop it
and read from the runner replay, or stop re-persisting replayed events and make `/new` a
single atomic reset. **Whichever way: this path has zero tests** — no `store.test.ts`, and
`resetSession`/`newSession`/`deleteSession` in `runner-supervisor.ts` are uncovered. Add
tests for append-on-dispatch, the restart double-append, `loadOlder` dedup, and the
`/new` dual-clear as part of the fix.

---

## P2 — Medium

### 3. Shared HTTP-channel server base — OPEN
**Cross-cut 1.4.** `readRequestBody` + `bearerTokenMatches` are shared (done), but each
HTTP surface still rolls its own `createServer`/`listen`/health/routing
(`plugin-channel-http/src/channel.ts:60`, `plugin-channel-web/src/channel.ts:180`,
`plugin-webhooks/src/server.ts:63`). **Action:** an optional `HttpChannelServer` base in
the SDK so they differ only in routing. (Larger refactor, lower payoff than the helpers
already hoisted.)

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
  reject **reason** per gate (see #10), which covers the diagnosability this bullet was after.

### 6. Mode loop scaffolding is copy-pasted across mode-default and mode-goal — 🔴 NEW
**Found 2026-06-08.** The mode-slimming PR (#93) collapsed the mode list but left the
per-iteration loop duplicated: `mode-default/src/turn-iterator.ts:168-272` vs
`mode-goal/src/goal-loop.ts:333-436`. `executeToolUses` differs only in comments/whitespace;
`emitRequestsAndDetectStuck` differs only in error strings; the provider-request/response +
overflow/reactive-compaction block (`turn-iterator.ts:67-127` vs `goal-loop.ts:128-182`)
is near-identical. Critically, the **orphan-tool-result / stuck-loop fix** (load-bearing —
the comments literally say "See the same fix in mode-tool-use") is copy-pasted, so any fix
must be hand-mirrored. **Action:** hoist the shared iteration scaffolding into an SDK
`mode-helpers` building block (per the repo's "prefer swappable blocks" guideline) so both
modes compose it. **Severity med.**

---

## P3 — Low / per-package nits

### 7. plugin-memory caches embeddings via a parallel `EmbeddingIndex` — OPEN
**Cross-cut 1.11.** `plugin-memory/src/store.ts:6,88-96` still uses its own `EmbeddingIndex`
cache instead of the SDK `CachedEmbeddingProvider`. **Deferred:** now that the atomic-write +
recall-race bugs are fixed, this is pure dedup of caching logic over a subtle mutex-guarded
recall path — low value, real risk. Fold in only if the recall path is touched anyway.

### 8. Channel→core prod dependency — OPEN
`plugin-cli`/`plugin-telegram` keep real `@moxxy/core` prod imports (`savePreferences`,
`clearUsageStats`, `newTurnId`, `loadUsageStats`, `PermissionEngine` — e.g.
`plugin-cli/src/session/run-slash.ts:2`, `plugin-telegram/src/channel/turn-runner.ts:2`).
To fully sever channel→core, hoist these provider-neutral helpers into `@moxxy/sdk`
(cross-cut 2.14). (`plugin-subagents`/`plugin-view` keep core as a **dev**Dep only — their
`*.test.ts` import core; correct, leave them.)

### 9. Small casts / hardcoded values — NEW, low
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

### 10. Desktop self-update "downloads but reverts" — ROOT-CAUSED + FIXED, pending on-build verify
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

---

## Resolved ledger (verified still in place 2026-06-08)

Collapsed from full write-ups; each was re-checked against `HEAD` and confirmed — no
regressions. Restore the detail from git history (`TECH_DEBT.md` @ `b014c3a`) if needed.

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
