# Main-branch deep audit — 2026-06-09

**Scope:** `origin/main` — base pass at `2d6e216` (Version Packages #118) + delta pass for `2d6e216..f13b007` (PR #119 ESM hot-update marker, PR #120 shared client layer / WS bridge / mobile, #121 version bump).
**Method:** two multi-agent workflows (38 agents, ~1,250 tool calls): 18 area auditors → adversarial verification of every new critical/high finding (each verifier instructed to refute). 155 raw findings → 14 **confirmed** critical/high, 5 refuted, rest medium/low or already journaled. Every auditor read `TECH_DEBT.md` first; "NEW" below means not in the journal.

---

## 0. Release blocker — do this before anything else

### B1. Desktop 0.0.33 boot-crashes: packaged main statically imports `@moxxy/ipc-server-ws`, which is externalized and never packaged — **CONFIRMED critical (regression, PR #120)**
`apps/desktop/electron/main/index.ts:47` has a top-level value import of `@moxxy/ipc-server-ws`, evaluated at module load **regardless of `MOXXY_WS_BRIDGE`**. PR #120 added the dep to `apps/desktop/package.json` but never touched `electron.vite.config.ts` — `BUNDLED_WORKSPACE_DEPS` (lines 13–20) doesn't list it, so `externalizeDepsPlugin` leaves a bare specifier in `dist-electron/main/index.js` that cannot resolve in the packaged app (`build.files` = `dist`/`dist-electron` only; the config's own comment documents exactly this MODULE_NOT_FOUND failure mode, learned in commit `4ce9fab`).
**Blast radius:** (1) the auto-cut **`desktop-v0.0.33` release — currently a DRAFT; do not publish it** — fresh installs would crash at boot with no fallback (this *is* the floor); (2) the Tier-1 hot-update bundle built from the same tree fails as an override on existing installs → boot probe marks it bad → **re-poisons self-update right after PR #115/#119 fixed it**.
**Fix:** add `@moxxy/ipc-server-ws` to `BUNDLED_WORKSPACE_DEPS`, or better, make the bridge a guarded dynamic `await import()` behind the env flag (the `shell-updater.ts` pattern) so a missing module can never kill boot. Verify with a real packaged build, rebuild the draft.

---

## 1. Confirmed high — security

### S1. Self-update bootstrap never verifies the bytes it executes
`desktop-host/src/app-update/`: the signed manifest binds only the **gzipped download's** sha256, checked once at download time (`stager.ts:276-280`). `resolveActiveBundleDetailed` (`resolve.ts:217-238`) checks signature/version/ABI/`existsSync` — **never hashes a file**. Comments claim "authenticity is enforced … authoritatively in the bootstrap at load time" — false. An unprivileged write to `~/Library/Application Support/<app>/app/` pairs a *genuine signed manifest* with a tampered `index.js` → persistent main-process code execution that survives reinstalls.
**Fix:** re-hash at load time (or sign a per-file hash manifest); at minimum correct the comments.

### S2. Goal-mode auto-approve discards user deny rules
`mode-goal/src/goal-loop.ts:63-71` replaces the **whole** wrapped resolver with unconditional-allow, throwing away `wrapWithPolicy`'s PermissionEngine — the only place `~/.moxxy/permissions.json` deny rules are consulted (verifier grep-confirmed). A `deny: [{name:'Bash'}]` rule is ignored precisely in the unattended mode. Docstring claims the opposite ("Auto-approve skips the prompt, not the policy"). No test covers deny-under-goal.
**Fix:** compose policy → auto-allow instead of replacing; add the missing test.

### S3. Webhook "sandbox" is not enforced
`webhook_create` tells the model and user the prompt "fires in an isolated session with the listed tools" / "sandboxed by `allowedTools`" (`plugin-webhooks/src/tools.ts:107-109,607-608`), but the production runner (`cli/src/setup/webhook-runner.ts:16-27`) runs `runTurn` on the **live session with no tool filter**. Attacker-controllable request bodies are interpolated into the prompt (`{body}`/`{header.*}`); under goal mode//yolo a prompt-injected webhook gets the full tool set.
**Fix:** pass an allowedTools-scoped resolver into webhook fires, or fix the descriptions so no one makes trust decisions on a false premise.

### S4. `provider_test` routes raw API keys through model context
`plugin-provider-admin/src/index.ts:82-85,195-197` requires the plaintext key as a model-generated tool argument → it lands in the LLM request, `~/.moxxy/sessions/*.jsonl`, and the desktop NDJSON log. Contradicts `provider_add`'s own "never ask them to paste the key to you". `ctx.getSecret` already exists and is ignored. (Verifier: real, severity arguably medium-high since the user supplies the key knowingly.)
**Fix:** accept a vault key *name*, resolve via `ctx.getSecret`.

### S5. `browser_session.goto` has no SSRF guard; its comment claims parity with `web_fetch`
`web_fetch` blocks loopback/RFC-1918/link-local/metadata IPs and re-validates redirects (`web-fetch.ts:69-114`, with tests). `browser_session` — strictly more powerful (`text`/`html`/`eval`) — only checks the scheme (`browser-session.ts:35`, sidecar `dispatch.ts:85`), while the comment claims it's "the same guard". `goto http://169.254.169.254/…` + `text` exfiltrates.
**Fix:** hoist `assertPublicUrl` into a shared helper, call it in both goto paths.

---

## 2. Confirmed high — stability

### T1. kill-by-port: channel-web SIGKILLs whatever holds port 4040 — ngrok's default UI port
`plugin-channel-web/src/channel.ts:31-74,137,236`: on EADDRINUSE it `lsof`'s the port and SIGTERM→SIGKILLs every PID with **no identity check**. Default port 4040 = ngrok's local API port, and this repo ships ngrok integrations; the web surface is **co-attached by default to every run** (`web-surface.ts:26-44`). Two auditors found this independently. The runner has a sibling of the same pattern (TCP 4040 protocol-mismatch recovery, `core-sdk-runner` finding).
**Fix:** never kill blind — fall back to an ephemeral port (code already re-reads the bound port), and/or verify the PID is a moxxy process. Move the default off 4040.

### T2. channel-web WS frames unvalidated → one malformed frame kills the whole process
`channel.ts:357-375` casts `JSON.parse` to `ClientFrame` with no zod; `{"kind":"prompt"}` throws synchronously in the `ws` message listener. Verifier **empirically reproduced** the process exit. This surface is deliberately internet-exposed via tunnels, and the repo has **zero** `unhandledRejection`/`uncaughtException` handlers in any long-lived entry point (separate medium). Breaks the repo's own zod-at-boundary convention (http channel and desktop IPC both validate).
**Fix:** `clientFrameSchema.safeParse` + drop/NACK invalid frames; add last-resort process handlers.

### T3. TUI probe/light-boot sessions leak daemons; the webhook port gets stolen
Three CLI paths (`run-tui.ts:228-238`, `bin.ts:236-244`, `run-channel.ts:34-38`) boot throwaway sessions **without** `skipInitHooks` and never close them → each starts a real scheduler poller + webhooks listener. `moxxy telegram` self-host boots **three** sessions; the orphaned probe wins the webhook port bind and the real session's bind failure is a silent `logger?.warn` under `silentLogger` → incoming webhooks run turns on an abandoned session. The authors know the rule — `start-registered-channel.ts:41-48` does it right.
**Fix:** `skipInitHooks: true` + close at all three sites; better, a `probeRegistries()` helper that can't grow daemons.

### T4. `/new` on any attached client is cosmetic — and bricks the client mirror
The runner protocol has **no reset RPC** (`protocol.ts:28-67`); `/new` clears only the local mirror (`remote-session.ts:254-258`) while claiming "conversation history cleared". The runner's log — which builds the next provider request — keeps everything. Worse: after `mirror.clear()`, `EventLog.ingest`'s seq-contiguity check (`log.ts:87`) rejects **every subsequent event forever**. Affects TUI attach (the default when a runner is up) and Telegram. PR #102 fixed this for desktop only. Two auditors found it independently; related: local `/new` keeps appending to the same JSONL, so wiped history resurrects on `--resume`.
**Fix:** add a `session.reset` RunnerMethod (abort in-flight, clear + truncate persisted log, broadcast reset); make mirrors handle it.

### T5. `afterWorkflow` triggers have no cycle detection — mutual triggers loop forever
`cli/src/setup/workflows.ts:184-188`: only guard is direct self-trigger; each run emits a fresh `workflow_completed`, so A↔B (or A→B→C→A) loops indefinitely, **spawning subagents and burning provider tokens each iteration**. The `inFlight` set clears before the next completion arrives (verifier traced it).
**Fix:** trigger-chain visited set / depth counter (mirror `dag.ts` MAX_NESTING_DEPTH); detect static cycles at load.

### T6. `safe-publish.mjs` can permanently ship a broken `@moxxy/cli`
Publishes in `readdirSync` order (cli before sdk), and tombstone bumps never re-pin dependents — published cli pins sdk to an **exact** version (`npm view` confirms `'@moxxy/sdk': '0.6.0'`), and npm history shows tombstone-walked gaps actually happen (0.3.0→0.5.0). A bump after cli publishes leaves cli pinned to a version that will never exist.
**Fix:** topo-order the publish (sdk first), re-pin/re-publish dependents after bumps, or use `workspace:^`.

### T7. Default `moxxy mobile` prints an unconnectable QR
`plugin-channel-mobile`: server binds `127.0.0.1` (`channel.ts:66`) but the QR advertises the **LAN IP** (`channel.ts:115` + `tunnel.ts:30-37`) → phone gets connection refused, while `apps/mobile/README.md:25` documents this exact flow as the way to connect. PoC, but the one documented happy path doesn't work.
**Fix:** advertise the bind host, or bind to the advertised interface when no tunnel is chosen.

---

## 3. Refuted findings (verified false — don't chase these)

- **Renderer replay storm / ghost streaming text** (desktop-renderer): the attach replay is fully ingested into the RemoteSession mirror **before** `attach()` resolves, and the SessionDriver subscribes only after — historical events never reach the renderer. Real residue (low): `assistant_chunk` bloats session JSONL and is re-parsed host-side on every attach.
- **WS bridge denylist-vs-allowlist RCE** (delta): renderer-equivalence is the documented design; the token *is* the full-trust pairing credential; off-by-default, loopback-only by default, 256-bit token, constant-time compare. The legitimate residue is the medium hardening list below.
- **Cleartext ws:// LAN token = vuln** (mobile): requires explicit opt-in to `bindHost 0.0.0.0`; a TLS tunnel path exists and is documented; same pattern as the pre-existing web channel.
- **Isolator "hard-fails every tool but Read" / "loader-hook boundary bypassable"** (2 highs, refuted at medium confidence): overstated, but the kernel is real and kept below — the strong isolators have ~no usable consumers and stale doc/test claims.

---

## 4. Systemic themes (the patterns behind the findings)

1. **TECH_DEBT.md — the journal itself regressed.** PR #115 rewrote it from a stale base, resurrecting items #107/#108 had retired and deleting resolved-ledger entries; #120 did **not** repair it. Four auditors flagged this independently. Since AGENTS.md makes the journal load-bearing for every agent's work, fix it first or it will keep poisoning future work.
2. **Docs that promise guarantees the code doesn't enforce.** Bootstrap "authoritative load-time verification" (S1), goal-mode "skips the prompt, not the policy" (S2), webhook "sandboxed by allowedTools" (S3), browser "same guard as web_fetch" (S5), web renderer "defense-in-depth", isolator loader-hook tests. This is its own class of debt: every one of these misleads both users and future agents.
3. **`/new` semantics are broken everywhere except desktop** (T4 + JSONL resurrection + desktop double-persistence P1 #2). One runner-side `session.reset` RPC retires the whole cluster.
4. **kill-by-port as "recovery"** in two places (channel-web, runner protocol-mismatch), both defaulting to ngrok's port.
5. **Auth on attach surfaces is inconsistent.** Runner unix socket: no auth (chmod-after-listen race, nothing on Windows pipes, any client can abort any other's turns). WS bridge: solid token but in the URL query string, no Origin check, no expiry/rotation, no connection cap/backpressure. Channels: token-in-query on web, too.
6. **Duplication worth consolidating:** token persistence ×3 (ws-bridge, channel-auth, resolveChannelToken — shipped in the *same PR*); JSON-RPC ×2 (runner JsonRpcPeer vs WS client); registry-snapshot/diff ×2 (self-update, plugins-admin); MobileSessionHost copy-pastes SessionDriver's ask semantics; worker/subprocess isolator scaffolding ~100 lines; streaming tool-call accumulation ×3 providers; tunnel spawn ×3 (journaled).
7. **Package split/join verdicts (asked for explicitly):** the two embeddings packages and two whisper packages are **not** drifted forks — different backends / real dependency reuse; keep all four. `plugin-provider-claude-code` already thin-shims `AnthropicProvider` — no merge needed. Cut or fix: `isolator-wasm` (unreachable dead code, unenforceable timeout), `apps/fixture-recorder` (bin silently no-ops, output consumed by nothing), the eager `createMcpPlugin` path, SDK voice helpers (dead exports with three live near-duplicates elsewhere).

---

## 5. Medium backlog (grouped, all file-cited in the appendix)

**Security-ish:** MCP credentials plaintext through tool args + disk (no vault refs); agent-view links allow `javascript:` hrefs (+ renderer doesn't re-validate URL schemes); web_fetch DNS-rebinding TOCTOU; webhook secrets echoed into model context/session logs; generated `webhooks.json` corrupt-read → silently treated as empty → next write wipes all triggers; runner socket auth (theme 5); WS-bridge hardening set (Origin check, token rotation, header-not-query, connection cap, backpressure, reconnect outbox replay ×2 packages).
**Stability:** no global unhandledRejection handlers anywhere; `EventLog.ingest` discards async listener rejections; session persistence swallows write failures silently; restored logs never re-sequenced (one corrupt line silently truncates all attached clients); refresh-token rotation (claude-code/codex) unserialized across processes — can lock users out; `RunnerSupervisor.restart()` bare-kill EADDRINUSE race; Bash tool: no process-group kill + unbounded output buffering; desktop release tag pushed before installers build (failure burns the version); mode-goal imports zod as devDep / desktop-host imports @moxxy/core as devDep (packaging time-bombs of the same class as B1); empty `assistant_message` events can wedge a session log; HTTP channel concurrent turns on one shared log; MobileSessionHost.dispose parks pending asks forever.
**Performance:** default compactor's "summary" is a first-5-lines truncation with fabricated `tokensSaved` (production compaction destroys context); TUI `estimateContextTokens` re-walks the whole log per render at ~30Hz; chat-log `loadSegment` re-reads the entire NDJSON per page; MemoryStore O(N) re-index per write, unbounded; goal-mode nudge defeats the stable-prefix cache breakpoint; desktop double-persistence now multiplied by WS/mobile clients (each client re-appends the host chat log; each WS connect re-appends replayed history).
**Dead ends / leftovers:** Tier-2 core-update structurally inoperable in the bundled CLI (NOT journaled); `moxxy://` deep-link transport shipped with no consumer; `req.system` silently dropped by the provider contract (hook-injected text lost); codex drops `maxTokens`/`temperature`, `reasoningEffort` pinned to medium; runtime openai-compat providers are second-class (misattributed name "openai", 3-way env-key derivation, envVar honored by desktop only); AGENTS.md still ships deleted `@moxxy/mode-tool-use` as the default mode; published sdk README still documents plan-execute/bmad; docs site: compile-fail samples, 32/48 packages, "three providers"; 8 undocumented `MOXXY_*` env vars; Expo SDK 51 pin (2024-era) with CI only typechecking the mobile app.

---

## 6. What's verifiably healthy (positive results worth keeping)

- **PR #108 hoist is faithful** — event ordering incl. `goal_stuck`-before-fatal preserved (diffed against both old copies); orphan-tool-result machinery genuinely centralized, stuck-tool fix holds in all modes incl. deep-research.
- **PR #101 descriptor-miss fallback holds** for both compaction and elision.
- **PR #120 extraction fidelity** — ~20 moved modules differ only in import paths; deleted desktop files (speech, voice recorder, mode badge) all faithfully relocated; DOM-free claim compile-enforced.
- **PR #105 npm-injection guard sound** on both paths; MCP shutdown/timeouts solid; stores use atomic writes + mutexes.
- Vault (AES-256-GCM, 0600, canary) and OAuth (PKCE+state) well-built; no plaintext vault leakage into event logs.
- Embedding-cache key-collision fix in place everywhere; depcruise 546 modules / 0 violations; PR #85 release fix correct; TUI streaming-overflow fix robust with load-bearing comments.

---

## 7. Suggested attack order

1. **B1** (unblock desktop releases; do not publish the 0.0.33 draft) — 30-minute fix + packaged-build verify.
2. **Repair TECH_DEBT.md** (restore #107/#108 retirements; add the new confirmed items) — keeps every future agent honest.
3. **S1 + S2 + S3** (the three trust-model lies) and **T1/T2** (the two internet-adjacent crashers) — small, surgical, high-value.
4. **T4 cluster** via one `session.reset` RPC; **T3** via `skipInitHooks` + probe helper.
5. **T5, T6, S4, S5** — each is an afternoon.
6. Then the medium backlog by theme (WS hardening set before the bridge leaves opt-in; compactor before long sessions matter).

---

## Appendix A — every finding (base pass, 121)

(area | severity | category | verification | new-vs-journaled | title)

| area | sev | category | verdict | known? | finding |
|---|---|---|---|---|---|
| desktop-renderer | high | stability | — | journaled | Runner full-history replay appended after the 50-event NDJSON window scrambles transcript order on every restart |
| desktop-renderer | high | performance | ❌ refuted (high) | new | assistant_chunk has no replay dedup: reconnect re-streams the whole history and can strand ghost streaming text |
| desktop-renderer | medium | regression | — | new | PR #115 reverted TECH_DEBT.md to a stale base, un-retiring the PR #107 and PR #108 journal entries |
| desktop-renderer | medium | stability | — | new | No ask-cancel IPC: a torn-down driver leaves a stale permission/approval sheet the user can 'answer' into the void |
| desktop-renderer | medium | performance | — | new | Transcript Footer is an inline component and re-parses the full streaming markdown per chunk |
| desktop-renderer | medium | inconsistency | — | new | usePrefs keeps an independent copy per consumer — the exact staleness bug useDesks was rewritten to fix |
| desktop-renderer | medium | stability | — | new | ProfilePill/ProfileView call Clerk hooks unguarded — a keyless build crashes the whole shell into the ErrorBoundary |
| desktop-renderer | low | duplication | — | new | Loopback port list triplicated, and a port-fallback boot silently changes the renderer origin (Clerk session + localStorage loss) |
| desktop-renderer | low | stability | — | journaled | /new still clears the renderer before resetting the runner — desync window on failure |
| desktop-renderer | low | stability | — | new | Queued-turn ids can collide after a drop, breaking React keys and dropFromQueue |
| desktop-host | high | security | ✅ confirmed (high) | new | Self-update bootstrap never re-verifies extracted bundle files against the signed sha256 — load-time integrity claim is false |
| desktop-host | medium | dead-end | — | new | moxxy:// deep-link transport (PR #117) is fully wired but has no consumer — dead-end scaffolding with no origin/param validation |
| desktop-host | medium | stability | — | new | RunnerSupervisor.restart() uses bare child.kill() + immediate respawn, reintroducing the EADDRINUSE race every other teardown path guards against |
| desktop-host | medium | performance | — | new | chat-log loadSegment re-reads and JSON.parses the entire NDJSON file on every scroll-up page, contradicting its own cursor-pagination claim |
| desktop-host | low | duplication | — | new | Socket-probe and lsof-PID-kill logic duplicated between runner-supervisor.ts and sweep-sockets.ts |
| desktop-host | low | security | — | new | session.runCommand dispatches a registered command with renderer-supplied args but is absent from the IPC validation schema |
| desktop-host | medium | duplication | — | journaled | Desktop double-persistence + /new desync (TECH_DEBT P1 #2) — growth piece fixed, double-source-of-truth and untested reset remain |
| tui | high | stability | ✅ confirmed (high) | new | Probe/light-boot sessions leak running daemons (scheduler poller + webhooks listener) and are never closed — webhook port is stolen from the real session |
| tui | high | missing | ✅ confirmed (high) | new | /new in attach mode is cosmetic: it clears only the client mirror, the runner keeps the full conversation context (no reset RPC exists) |
| tui | medium | stability | — | new | Ctrl+T force-send (priority message) reads stale closure state — the prioritized message does not run after the current turn |
| tui | medium | stability | — | new | `moxxy resume <id>` silently ignores the chosen session when a runner is up |
| tui | medium | performance | — | new | estimateContextTokens re-walks the entire event log (incl. JSON.stringify of every tool result) on every render — ~30Hz during streaming |
| tui | medium | inconsistency | — | journaled | Attach-mode mode/provider switches report success even when the runner rejects them (fire-and-forget RPCs + no-op replace) |
| tui | low | leftover | — | new | Leftovers: deleted-mode comment, legacy /loop alias, ceremonial dead code, and a keep-alive interval whose unref contradicts its own comment |
| tui | low | inconsistency | — | new | Naive argv parsing: boolean flags greedily consume the next positional, and stringFlag is duplicated with divergent semantics |
| tui | low | stability | — | new | One-shot `moxxy -p` never closes the session — onShutdown hooks (scheduler stop, webhooks stop, memory/vault flush) are skipped on the success path |
| channels | high | security | ✅ confirmed (high) | new | Webhook triggers promise an isolated, allowedTools-sandboxed session but the production runner enforces neither |
| channels | high | stability | ✅ confirmed (high) | new | Web channel SIGKILLs whatever process holds port 4040 — which is ngrok's default local-UI port |
| channels | medium | security | — | new | Agent-authored view links allow javascript: URLs — click-XSS on a surface designed to be shared with third parties |
| channels | medium | stability | — | new | Corrupt or schema-mismatched webhooks.json is silently treated as empty — next write permanently wipes every trigger (and its secrets) |
| channels | medium | security | — | new | Generated webhook secrets are returned through the model's context and persist in session logs |
| channels | medium | stability | — | new | HTTP channel runs concurrent turns against one shared event log — cross-turn context contamination is acknowledged but unhandled |
| channels | medium | security | — | new | No rate limiting on any inbound channel endpoint; webhook bursts spawn unbounded concurrent LLM runs |
| channels | low | inconsistency | — | new | Telegram inline-keyboard callback path skips the pairing authorization gate that text/voice enforce |
| channels | low | security | — | new | Web surface: app.js served without the token and the auth token rides in the query string |
| channels | low | stability | — | new | Web channel silently drops typed prompts while busy; unbounded views/clients growth |
| channels | low | leftover | — | new | Stale references to the deleted plan-execute mode across the Telegram channel |
| channels | low | duplication | — | journaled | Tunnel-spawn triplication and per-package HTTP server scaffolding (journaled; unchanged) |
| core-sdk-runner | high | stability | ✅ confirmed (high) | new | /new on an attached client clears only the local mirror — the runner keeps the full conversation and the mirror goes permanently dead |
| core-sdk-runner | medium | regression | — | new | TECH_DEBT.md regression: PR #113 clobbered PR #108's journal update — retired item #6 is back as open, resolved-ledger entry lost |
| core-sdk-runner | medium | stability | — | new | Local /new clears the in-memory log but keeps appending to the same JSONL — wiped history resurrects on --resume with duplicate seqs |
| core-sdk-runner | medium | stability | — | new | Restored session logs are never re-sequenced — a single dropped/corrupt middle line silently truncates every attached client's history at that point |
| core-sdk-runner | medium | stability | — | new | Protocol-mismatch recovery SIGKILLs whatever process listens on TCP 4040 — ngrok's local web/API interface defaults to 4040 |
| core-sdk-runner | medium | security | — | new | Runner socket has no authentication: chmod-after-listen race on unix (failures swallowed), no Windows pipe ACL, and any attached client can abort any other client's turns |
| core-sdk-runner | low | leftover | — | new | Stale references to deleted/renamed modes: AGENTS.md still ships @moxxy/mode-tool-use as the default mode; SDK README/comments still cite plan-execute/bmad |
| core-sdk-runner | low | stability | — | new | savePreferences is a read-merge-write with no lock — concurrent writers drop each other's fields |
| core-sdk-runner | low | duplication | — | new | Small duplications and a dead wire parameter across the runner seam |
| core-sdk-runner | low | regression | — | journaled | PR #108 tool-batch hoist verified faithful — no behavior regression (informational) |
| modes | high | security | ✅ confirmed (high) | new | Goal-mode auto-approve bypasses user-configured deny rules from ~/.moxxy/permissions.json, contradicting its own documentation |
| modes | medium | regression | — | new | PR #115 regressed TECH_DEBT.md: resurrected the retired 'mode loop scaffolding copy-pasted' P2 #6 entry and deleted its resolved-ledger record |
| modes | medium | missing | — | new | Default compactor 'summary' is a first-5-lines truncation with fabricated tokensSaved — production compaction destroys context instead of summarizing |
| modes | medium | dead-end | — | new | req.system is dead weight in the provider contract — hook-injected system text (memory consolidation nudge) is silently dropped |
| modes | medium | stability | — | new | Empty assistant_message events (end_turn + tool calls with no text) project as empty text blocks that providers reject — can wedge a session log |
| modes | low | duplication | — | journaled | Residual duplicated outer-loop blocks between mode-default and mode-goal after PR #108 (overflow/reactive-compaction retry, provider bookends, stuck-report wiring) |
| modes | low | leftover | — | new | Dead exported constants in mode-deep-research and stale comments referencing the deleted plan-execute mode |
| modes | low | performance | — | new | Goal-mode nudge defeats the stable-prefix strategy's rolling tail breakpoint — guaranteed-wasted cache writes on idle iterations |
| providers | high | security | ✅ confirmed (high) | new | provider_test tool requires the raw API key as model-visible tool input, leaking it into model context and persisted session logs |
| providers | medium | inconsistency | — | new | All runtime-registered openai-compat providers report name 'openai' — usage stats and errors misattributed |
| providers | medium | inconsistency | — | new | Vault/env key name for runtime providers derived three different ways; the stored envVar override is honored by desktop but ignored by the CLI/runner |
| providers | medium | stability | — | new | Single-use rotating refresh tokens (claude-code, openai-codex) have no cross-process or cross-consumer serialization; vault persistence is whole-file last-writer-wins from an in-memory snapshot |
| providers | medium | inconsistency | — | new | Codex provider silently drops req.maxTokens and req.temperature |
| providers | medium | duplication | — | new | Streaming tool-call accumulation plumbing copy-pasted across all three streaming providers |
| providers | low | inconsistency | — | new | Abort is surfaced three different ways across providers — only anthropic emits the clean 'aborted' terminal event in all paths |
| providers | low | stability | — | new | provider_add rollback on persist failure detaches a previously-working provider instead of restoring it |
| providers | low | missing | — | new | provider_add's model schema cannot declare supportsDocuments, so attachments are degraded for all runtime providers |
| providers | low | dead-end | — | new | Codex reasoningEffort option is dead — every request is pinned to effort 'medium' |
| providers | low | leftover | — | journaled | Hardcoded Anthropic model catalog (incl. claude-opus-4-7 @ 800k) inherited verbatim by claude-code; requestBody/countTokens casts defeat type-checking on the request hot path |
| security-isolation | high | dead-end | ❌ refuted (medium) | new | Enabling any strong isolator (worker/subprocess/wasm) hard-fails every built-in tool except Read |
| security-isolation | high | security | ❌ refuted (medium) | new | Loader-hook 'boundary' is trivially bypassable, but comments and tests assert it closes the escape gap |
| security-isolation | medium | dead-end | — | new | WASM isolator is unreachable dead code with an unenforceable timeout |
| security-isolation | medium | inconsistency | — | new | Worker isolator inherits full process.env while subprocess/wasm curate it — inconsistent secret exposure |
| security-isolation | low | duplication | — | new | Worker and subprocess isolators duplicate ~100 lines of run()/settle/timer/abort/broker-loop scaffolding |
| security-isolation | low | leftover | — | journaled | exec-allowlist still read via `as unknown` cast though `commands` is now a typed CapabilitySpec field |
| plugin-infra | high | stability | ✅ confirmed (high) | new | afterWorkflow trigger has no cycle detection — mutual triggers loop forever |
| plugin-infra | medium | dead-end | — | new | Tier-2 core-update subsystem is structurally inoperable in the shipped bundled CLI |
| plugin-infra | medium | security | — | new | MCP server credentials flow plaintext through tool args and to disk; no vault placeholder resolution |
| plugin-infra | low | duplication | — | new | Registry-snapshot + diffSnapshot logic duplicated across plugin-self-update and plugin-plugins-admin (and the CLI wiring) |
| plugin-infra | low | dead-end | — | new | createMcpPlugin (eager connect-at-boot path) is dead/superseded scaffolding |
| plugin-infra | low | duplication | — | new | triggerSummary copy-pasted across three workflow files |
| plugin-infra | low | leftover | — | new | Leftover references to deleted modes/transport kinds in workflows comment and MCP docs |
| plugin-capabilities | high | security | ✅ confirmed (high) | new | browser_session.goto has no SSRF private-IP guard (only a scheme check), unlike its sibling web_fetch — comment falsely claims parity |
| plugin-capabilities | medium | security | — | new | Agent-UI web renderer renders href/src without URL-scheme re-validation; validateDoc omits URL checks — defense-in-depth claim is false |
| plugin-capabilities | medium | inconsistency | — | new | Base WhisperTranscriber ignores its package's own PCM16 normalizer and re-defines the filename table — raw PCM16 voice captures break on the standard OpenAI backend |
| plugin-capabilities | medium | performance | — | new | MemoryStore rebuilds the full index by re-reading+parsing every memory file on every write, and the store has no eviction/cap (unbounded O(N) growth) |
| plugin-capabilities | medium | security | — | new | web_fetch SSRF guard has a DNS-rebinding TOCTOU — resolution check and the actual fetch resolve independently |
| plugin-capabilities | low | duplication | — | journaled | plugin-memory still uses a parallel EmbeddingIndex cache instead of the SDK CachedEmbeddingProvider (known debt, still open) |
| builtins-config | medium | leftover | — | new | AGENTS.md still lists deleted @moxxy/mode-tool-use as the "active by default" mode |
| builtins-config | medium | dead-end | — | new | fixture-recorder's moxxy-record bin silently no-ops when invoked through its declared bin symlink |
| builtins-config | medium | dead-end | — | new | fixture-recorder output format is consumed by nothing; the one fixture-based test points at it with an incompatible format |
| builtins-config | medium | leftover | — | new | docs testing.md: every code sample uses APIs that don't exist |
| builtins-config | medium | stability | — | new | Bash tool: timeout/abort signals only the shell with SIGTERM — no process-group kill, no SIGKILL escalation |
| builtins-config | medium | performance | — | new | Bash tool buffers child output unboundedly in memory; 200k clamp applied only after exit |
| builtins-config | low | leftover | — | new | docs tools-builtin.md makes three false claims: six tools, PDF support in Read, core depends on the package |
| builtins-config | low | missing | — | new | Docs package reference covers 32 of 48 packages; quickstart says "three providers" after a fourth shipped |
| builtins-config | low | inconsistency | — | new | Grep and Glob diverge on symlink handling and glob-filter semantics |
| monorepo-hygiene | high | stability | ✅ confirmed (high) | new | safe-publish.mjs publishes in arbitrary readdir order and never re-pins dependents after tombstone bumps — cli can ship pinned to an sdk version that will never exist |
| monorepo-hygiene | medium | stability | — | new | Desktop release tag is pushed before the installers build — any desktop-build failure permanently burns that version |
| monorepo-hygiene | medium | inconsistency | — | new | @moxxy/mode-goal imports zod at runtime but declares it only as a devDependency |
| monorepo-hygiene | medium | inconsistency | — | new | @moxxy/desktop-host imports @moxxy/core in prod source while declaring it only as a devDependency |
| monorepo-hygiene | low | leftover | — | new | Uninstallable @moxxy/cli artifacts remain live on npm (workspace:* shipped verbatim) |
| monorepo-hygiene | low | leftover | — | new | AGENTS.md still documents deleted @moxxy/mode-tool-use as the default mode; published sdk README cites removed plan-execute/bmad modes |
| monorepo-hygiene | low | inconsistency | — | new | Catalog bypassed for react/react-dom peer deps in desktop-ui and vitest peer deps in testing/vitest-preset |
| monorepo-hygiene | low | dead-end | — | new | turbo.json defines a lint task no package implements; repo lint is uncached full-tree eslint |
| monorepo-hygiene | low | inconsistency | — | new | `pnpm changeset` is instructed by CI and AGENTS.md but @changesets/cli is not installed anywhere in the workspace |
| monorepo-hygiene | low | leftover | — | new | plugin-telegram declares zod as a prod dependency but never imports it |
| dead-code | medium | regression | — | new | TECH_DEBT.md regressed by stale merge: resurrects two already-fixed items and lost a resolved-ledger entry |
| dead-code | medium | dead-end | — | new | SDK voice helpers are dead exports; transcriber activation logic exists in three live near-duplicate copies anyway |
| dead-code | low | leftover | — | new | AGENTS.md still names the deleted @moxxy/mode-tool-use package; both AGENTS.md and README.md architecture lists omit plugin-channel-web and plugin-view |
| dead-code | low | leftover | — | new | Published @moxxy/sdk README documents the deleted plan-execute/bmad modes as the defineMode examples |
| dead-code | low | leftover | — | new | Dead core event selectors: selectPendingToolCalls and selectCurrentTurn exported but never used |
| dead-code | low | missing | — | new | Eight MOXXY_* env vars are read in code but documented nowhere (README, docs site, or the CLI --help ENV table) |
| dead-code | low | inconsistency | — | new | View allow-list 'single source of truth' claim is not wired: the web frontend hardcodes its own tag switch instead of importing VIEW_PRIMITIVES/VIEW_COMPONENTS |
| dead-code | low | dead-end | — | new | moxxy:// deep-link transport ships with no consumer (declared intentional, but unrouted public attack-surface plumbing) |
| consistency | high | stability | ✅ confirmed (high) | new | channel-web SIGTERM/SIGKILLs arbitrary processes holding its port on EADDRINUSE — unique among the three HTTP surfaces |
| consistency | high | inconsistency | ✅ confirmed (high) | new | channel-web WebSocket frames are not schema-validated; a malformed frame from a tokenized (internet-reachable) client crashes the whole process |
| consistency | medium | stability | — | new | No last-resort unhandledRejection/uncaughtException handler in any long-lived entry point, despite pervasive fire-and-forget dispatch |
| consistency | medium | stability | — | new | EventLog.ingest discards async listener rejections — the try/catch is dead code for promises, inconsistent with append() |
| consistency | medium | inconsistency | — | new | Session event-log persistence (the source of truth) silently swallows write failures, while sibling persistence paths warn |
| consistency | low | leftover | — | journaled | TECH_DEBT.md has drifted: two entries fixed on main (PRs #107/#108) are still listed as open |
| consistency | low | leftover | — | new | AGENTS.md and sdk/README still document the deleted mode-tool-use/plan-execute/bmad modes |
| consistency | low | inconsistency | — | new | desktop-host mixes bare console.warn with the repo's structured-logger convention on security-relevant paths |

## Appendix B — every finding (delta pass 2d6e216..f13b007, 34)

| area | sev | category | verdict | known? | finding |
|---|---|---|---|---|---|
| client-core-extraction | critical | regression | ✅ confirmed (high) | new | Packaged desktop main statically imports @moxxy/ipc-server-ws, which is externalized and not packaged — boot crash in the shipped 0.0.33 build |
| client-core-extraction | medium | duplication | — | journaled | Shared ChatStoreBridge wires chat.append persistence on EVERY client — a connected WS/mobile client double-appends the host's NDJSON chat log |
| client-core-extraction | low | dead-end | — | new | TextToSpeech capability is registered but never consumed through the registry — desktop bypasses it, so a non-web platform implementing tts gets nothing |
| client-core-extraction | low | stability | — | new | Multi-bus handler registration relies on a mutable module-level setActiveBus global |
| client-core-extraction | low | inconsistency | — | new | dispatch() now normalizes a handler's `undefined` result to `null` on the Electron path too — a silent wire-behavior change folded into the extraction |
| client-core-extraction | low | inconsistency | — | new | Desktop subscribes to SESSION_INFO_REFRESH_EVENT through two different mechanisms (window events in AgentPicker, EventBus capability in the shared badge hook) |
| client-core-extraction | low | leftover | — | journaled | @moxxy/design-tokens is declared as an apps/desktop dependency but nothing in the desktop imports it |
| client-core-extraction | low | missing | — | journaled | Verified non-findings: extraction fidelity, DOM-free enforcement, and the deleted desktop files |
| ws-bridge-security | high | security | ❌ refuted (high) | new | Desktop WS bridge exposes the entire IPC surface via a 6-entry denylist (allowlist would be safe) — token holder gets vault/skill/provider-key writes + auto-approve + RCE |
| ws-bridge-security | medium | security | — | new | No Origin/Host-header validation on the WS handshake — only the bearer token gates a network-reachable surface |
| ws-bridge-security | medium | security | — | new | Token transported in the URL query string — leaks via QR/stdout, tunnel-provider logs, and cleartext ws:// on LAN |
| ws-bridge-security | medium | security | — | new | Persistent, non-expiring pairing token with no rotation — a leaked QR/screenshot is permanent access |
| ws-bridge-security | medium | stability | — | new | No backpressure or connection limit — a slow/idle remote client can OOM the host via unbounded ws send buffering |
| ws-bridge-security | medium | stability | — | new | WsRpcClient re-executes abandoned requests after reconnect (outbox not cleared on close) |
| ws-bridge-security | low | duplication | — | journaled | Duplicate token-persistence logic: desktop main rolls its own instead of the shared resolveChannelToken |
| ws-bridge-security | low | stability | — | new | Malformed/oversized frames are silently dropped, never surfaced — bad client hangs forever with no diagnostics |
| ws-bridge-security | low | regression | — | new | dispatch() normalizes undefined→null, silently changing the Electron renderer's return value for void commands |
| ws-bridge-security | low | duplication | — | journaled | WS client JSON-RPC reimplements the runner's JsonRpcPeer instead of sharing it |
| mobile | high | inconsistency | ✅ confirmed (high) | new | Default `moxxy mobile` prints an unconnectable QR: server binds 127.0.0.1 but the QR advertises the LAN IP |
| mobile | high | security | ❌ refuted (medium) | new | LAN pairing is cleartext ws:// with the bearer token in the URL; the token grants full agent control (runTurn + setAutoApprove) |
| mobile | medium | stability | — | new | WsRpcClient replays rejected requests after reconnect (outbox not cleared on close) and reconnects forever with no surfaced failure |
| mobile | medium | stability | — | new | MobileSessionHost.dispose leaves the permission resolver installed and parks post-dispose asks forever |
| mobile | medium | duplication | — | new | MobileSessionHost copy-pastes the desktop SessionDriver's load-bearing ask/permission semantics |
| mobile | low | dead-end | — | journaled | Mobile channel/app is documented-PoC scaffolding on main: no transcript persistence, no-op retry, hardcoded 'connected' phase, raw-JSON renderer |
| mobile | low | security | — | new | README/App invite baking the bearer token into the JS bundle via EXPO_PUBLIC_* and boot side effect runs in a useState initializer |
| mobile | low | deprecation | — | new | Pinned Expo SDK 51 / RN 0.74.5 (2024-era) — documented `expo start` + Expo Go flow likely already unrunnable, and CI only typechecks the app |
| mobile | low | duplication | — | new | Desktop ws-bridge re-rolls token persistence instead of using the new SDK resolveChannelToken helper |
| desktop-delta-esm | medium | inconsistency | — | new | TECH_DEBT.md still misreports merged fixes #107/#108 as open debt — the #115 clobber was not repaired by #120 |
| desktop-delta-esm | medium | security | — | new | WS bridge exposes nearly the full desktop IPC surface (vault writes, ask approvals, update install) over plaintext ws:// with a permanent token also accepted as a URL query parameter |
| desktop-delta-esm | low | stability | — | new | wss.close() never terminates connected clients, so desktop quit always burns the full 3s shutdown timeout while a WS/mobile client is attached |
| desktop-delta-esm | low | duplication | — | new | Desktop ws-bridge token logic duplicates the SDK resolveChannelToken shipped in the same PR, and channel-auth re-rolls a divergent private moxxyHome() |
| desktop-delta-esm | low | missing | — | new | PR #119 has no retro-migration for already-staged markerless bundles — a staged legacy override (or a confirmed rollback target) still burns a failed-boot + poison cycle |
| desktop-delta-esm | low | regression | — | new | dispatch() now normalizes a successful undefined to null on the Electron path, contradicting the 'identical to the pre-refactor wire shape' claim |
| desktop-delta-esm | low | leftover | — | new | WS bridge port/address edge cases: empty MOXXY_WS_PORT silently binds an ephemeral port and TransportServer.address reports the requested, not bound, port |

_Generated by two Claude Code audit workflows (38 agents); every critical/high finding adversarially verified. Fix series starts at PR #126._
