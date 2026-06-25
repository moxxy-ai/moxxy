# @moxxy/sdk

## 0.20.0

### Minor Changes

- 2ccd62e: EventStore registry — make the session event-log storage backend swappable (Pillar 2).

  The JSONL persistence behind a session's event log is now a registry kind (`eventStore`) like any other swappable block, behind a new `EventStoreDef` contract (`open(scope)` for the write path; `restore`/`readPage` for resume + history paging). Core seeds the built-in JSONL store (`~/.moxxy/sessions/<id>.jsonl` + meta sidecar) as the **protected floor** — a thin adapter over the existing `SessionPersistence`, so behaviour is byte-identical.

  A plugin can contribute an alternative store (SQLite, remote, encrypted, in-memory). Because the kind uses throw-on-duplicate `register` (not override) and the floor auto-adopts first, a discovered store is registered but never silently activates — the user opts in by name via `plugins.eventStore.default`. Since the store sees every event (prompts, tool I/O), that explicit opt-in is the trust boundary. The floor can be swapped but never removed, and a boot assertion guarantees a session always has an active store.

  `SessionMeta`/`SessionSource`/`EventPage` moved to `@moxxy/sdk` (the contract's data shapes) and are re-exported from `@moxxy/core` — no importer churn.

- bddaa83: Inter-plugin service registry (`AppContext.services`) — plugins publish a named service in `onInit` and consume siblings' services in theirs, requirements-ordered so the provider runs first. This decouples cross-plugin dependencies from the host's `build*({ deps })` constructor wiring, letting a plugin be discovery-loaded (default-exported) instead of hand-built by the orchestrator.

  The vault plugin now publishes its secret store (`services.register('vault', vault)`), and `@moxxy/plugin-oauth` is the first consumer to go discovery-loadable: the default-exported `oauthPlugin` resolves the vault from `ctx.services.require('vault')` in `onInit` (declaring `@moxxy/plugin-vault` as a requirement for ordering), so it no longer needs the `{ vault }` closure. `buildOauthPlugin` is kept for direct injection.

  Since plugin `onInit` already runs with full in-process privileges (the security isolation wraps tool execution, not plugin code), this doesn't widen the effective trust surface.

- 5c1c334: The host now publishes its core registries on the inter-plugin service registry under well-known names (`agents`, `tools`, `providers`, `viewRenderers`, `synthesizers`), and the SDK exposes a minimal `NamedRegistry<T>` view (`get`/`list`/`has`) so a discovery-loaded plugin can resolve one in `onInit` without importing `@moxxy/core`'s concrete registry types.

  Two more closure-injected plugins go discovery-loadable on this seam: `@moxxy/plugin-subagents` (`subagentsPlugin` — resolves the `agents` + `tools` registries for `dispatch_agent`'s kind lookup + parent-tool snapshot) and `@moxxy/plugin-voice-admin` (`voiceAdminPlugin` — resolves the `synthesizers` registry for `list_voices`/`set_voice`). Both read the registries lazily at tool-call time and keep their `build*` factories for direct injection. `builtin-entries` uses the default exports.

- 2ccd62e: Unified `plugins:` manifest + critical floor (Pillar 1).

  Replace the three overlapping config stores (the flat `provider`/`mode`/`compactor`/`workflowExecutor` keys, the package-keyed `plugins:` map, and `~/.moxxy/preferences.json`) with a single category-grouped `plugins:` tree in `~/.moxxy/config.yaml`:

  - **`plugins.packages.<pkg>`** — the install/enable ledger (one entry per npm package).
  - **`plugins.<category>.{default, items}`** — the swap axis, one slot per registry kind, keyed by contribution name (e.g. `plugins.provider.default: anthropic`).

  A **critical floor** makes the platform unbreakable: core default modules can be _swapped_ to another registered implementation but never _disabled_ — a missing/typo'd default reverts to a protected built-in floor, kernel packages refuse to be disabled (`PLUGIN_PROTECTED`), and a boot assertion guarantees every non-nullable slot is filled.

  New swap surfaces: the `set_default`/`list_defaults` model tools, `moxxy plugins set-default`/`defaults`, the TUI `/plugins` **Defaults** tab, and a `PluginsAdminView.categories()`/`setCategoryDefault()` view contract.

  `preferences.json` is retired: the persisted provider/mode/model/disabled-set now live in the same tree, written through `@moxxy/config` (`setCategoryDefault`/`setProviderModel`/`setProviderEnabled`). **Breaking (pre-1.0, no back-compat):** existing `~/.moxxy/config.yaml` files using the old keys must be rewritten; `moxxy init`'s output and `config_init`'s template emit the new shape.

## 0.19.0

### Minor Changes

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

## 0.18.0

### Minor Changes

- e4fe785: Make scheduled prompts and workflow triggers multi-tenant across concurrent runner processes.

  The desktop runs one `moxxy serve` per workspace, and every runner ran its own scheduler poller / workflow-trigger wiring over the SAME shared stores. A due schedule (and any workflow it fires) therefore ran once **per runner** — N times for N open workspaces — and skill/workflow-mirrored schedules had no notion of which runner should own them.

  Now:

  - Schedules carry an optional `ownerSessionId`. `schedule_create` stamps it with the creating runner's `MOXXY_SESSION_ID`, so a schedule created in a workspace's chat fires only on **that** runner (its result lands where it was asked for), not whichever poller happens to tick first.
  - Owner-less schedules (skill- and workflow-mirrored rows, or a single-process CLI with no session id) fire **exactly once across all runners** via a new cross-process "fire exactly once" lock (`CrossProcessFireLock`, exported from `@moxxy/sdk/server`) keyed on the entry's exact fire instant.
  - Workflow `fileChanged` triggers are likewise guarded by the cross-process lock in the multi-runner case, so one edit runs the workflow once instead of once per watching runner.

  Single-process CLI/TUI behavior is unchanged (no `MOXXY_SESSION_ID` → owner-less, fires as before).

## 0.17.0

### Minor Changes

- 0d6df6e: Add an `echo` workflow step — deterministic output with no agent turn.

  `echo` renders a template (`{{ steps.<id>.output }}`, `{{ vars.* }}`,
  `{{ inputs.* }}`, `{{ now }}`) and uses it verbatim as the step's output, without
  spawning a child agent. Use it for pure formatting/delivery steps (e.g. emit an
  already-written digest) where a `prompt` step would burn a model call and could
  re-interpret or loop on the content. The workflow drafter now prefers `echo` over
  a `prompt` for pass-through/delivery steps.

## 0.16.1

### Patch Changes

- 648c966: Sync desktop/mobile session state, auto-approve, and OpenAI cached-token usage for context meters.

## 0.16.0

### Minor Changes

- b19d401: Self-hosted **proxy** tunnel — a private replacement for ngrok/cloudflared.

  A locally-running agent is exposed at `https://<uuid>.proxy.moxxy.ai` via a
  self-hosted relay it dials outbound. Identity is a per-install Ed25519 keypair
  (no account, no login — the headless CLI works): `uuid = base32(sha256(pubkey))`,
  ownership proven by signing a relay challenge. One agent multiplexes several
  local services under its subdomain via path routing (`/mobile`, `/web`,
  `/webhook`).

  The mobile pairing path is **end-to-end encrypted inside the tunnel**
  (`@moxxy/e2e`): the QR carries the agent's public-key fingerprint (`?fp=`), the
  app pins it and runs a signed-ephemeral-ECDH handshake + XChaCha20-Poly1305
  framing, and the bearer token rides encrypted — so the relay (which terminates
  the outer TLS) sees only ciphertext it can neither read nor forge, and cannot
  impersonate the agent.

  The desktop **Settings → Mobile** "Start mobile" toggle now opens the same E2E
  proxy path: enabling the gateway exposes it at `wss://<uuid>.proxy.moxxy.ai/mobile`
  (QR + pinned fingerprint) so a phone can pair from anywhere, not just the same
  Wi-Fi. If the relay is unreachable it falls back to the LAN URL; `MOXXY_MOBILE_NO_PROXY=1`
  forces LAN-only. (`openMobileProxyTunnel` is exported from
  `@moxxy/plugin-channel-mobile/e2e-proxy`, shared by the CLI channel and the desktop.)

  **Breaking (`@moxxy/sdk`):** `proxy` is now the sole tunnel provider —
  `cloudflared`/`ngrok` and the `spawnCliTunnel` / `isCliTunnelAvailable` helpers
  (plus `SpawnCliTunnelOptions` / `CliTunnelHandle`) were removed. `TunnelOpenOptions`
  gains an optional `label` for path-routed multiplexing. The web preview and the
  webhooks listener now expose themselves through the proxy relay; the
  `webhook_tunnel_start` tool no longer takes a `kind`.

  The relay server itself lives in a separate private repo (not published).

## 0.15.2

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

## 0.15.1

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

## 0.15.0

### Minor Changes

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

## 0.14.5

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

## 0.14.4

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

## 0.14.3

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

## 0.14.2

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

## 0.14.1

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

## 0.14.0

### Minor Changes

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

## 0.13.0

### Minor Changes

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

- 7366a09: Add a cross-channel file-diff preview for the Write/Edit tools. Every surface
  now shows what changed when the agent writes a file — a classic diff of the
  changed slices (±2 context lines) with line numbers, `+`/`-` markers, and
  green/red line backgrounds, plus a "Added N lines, removed M lines" summary.

  - The tools return a structured, channel-agnostic payload (`ToolDisplayResult`
    = `{ forModel, display }`); the model still sees only a short summary line, so
    the diff never bloats the context window.
  - TUI: an inline highlight preview; `Ctrl+O` expands the changed files.
  - Desktop: a diff card; click to expand the full set of hunks.
  - Web / Telegram / mobile each render the same payload natively.

  New public SDK surface (`@moxxy/sdk` and the dependency-free `@moxxy/sdk/tool-display`
  subpath for browser/React-Native consumers): `FileDiffDisplay`, `DiffHunk`,
  `DiffLine`, `DiffRow`, `ToolDisplay`, `ToolDisplayResult`, and the helpers
  `isToolDisplayResult`, `isFileDiffDisplay`, `fileDiffSummary`, `fileDiffVerb`,
  `diffGutterNo`, `toDiffRows`.

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

## 0.11.0

### Minor Changes

- aacdf1d: Desktop: live registry refresh + interactive provider management.

  The runner now broadcasts `info.changed` after every completed turn, so registry changes made by tools inside a conversation (provider_add, mcp_add, workflow_create, skill writes, …) reach attached clients; the desktop forwards the push to the renderer (`session.info.changed` → `SESSION_INFO_REFRESH_EVENT`) and the Settings panel re-fetches live — no more app restart to see an agent-added provider.

  Settings → Providers is now interactive: enable/disable any provider (runner protocol v7 `provider.setEnabled`, persisted to `preferences.json#disabledProviders` and honored by boot's activation walk; disabling the ACTIVE provider is refused), and a Configure sheet sets the API key (vault + live readiness re-probe via `provider.refreshReady`) and, for runtime-registered providers, the stored baseURL/default model (`provider.configure` through the new `SessionLike.providerAdmin` view). OAuth providers get a `moxxy login` hint instead of a key form.

## 0.10.0

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

## 0.9.0

### Minor Changes

- 1e4ed09: chore(debt): unify tunnel spawning, finish MoxxyError adoption, retire stale casts

  Round-3 tech-debt drawdown:

  - **Tunnel unification (P2 #4).** New `spawnCliTunnel` + `isCliTunnelAvailable` exports on
    `@moxxy/sdk` own the spawn → parse-URL → resolve/reject lifecycle and no-orphan child
    cleanup for CLI tunnels. cloudflared/ngrok (channel-web) are now thin configs over it,
    and the webhooks plugin consumes registered `TunnelProviderDef`s instead of its own
    `startTunnel` (same URLs parsed, same teardown/pid/stop surface). channel-web's
    `child-cleanup.ts` is removed (folded into the SDK helper).
  - **MoxxyError adoption (P2 #5).** User-facing throws migrated to typed `MoxxyError`:
    oauth_authorize missing deviceUrl/authUrl (`TOOL_ERROR`), vault placeholder missing entry
    (`CONFIG_INVALID`), vault_get not-found (`TOOL_ERROR`), unsupported vault file
    (`VAULT_CORRUPT`). Internal invariant throws stay plain `Error`.
  - **Casts / hardcoded values (P3 #8).** Removed the `as unknown` exec-allowlist cast in
    plugin-security (CapabilitySpec.commands is now typed), tightened the Anthropic provider's
    `requestBody`/`countTokens` casts to the SDK's real param types (narrow, commented casts
    only where the SDK literal-narrows `media_type`), and corrected stale hardcoded model
    context windows (opus-4-7 / sonnet-4-6 are 1M, not 800k/200k) + maxOutputTokens.
  - **RemoteSession seam casts (P1 #1).** Dropped the redundant `as unknown as SessionLike`
    and command-handler casts in `desktop-host` (RemoteSession implements ClientSession →
    SessionLike; CommandContext.session is `unknown`).

### Patch Changes

- 4a8ec5d: Workflows round-2 correctness: gate the unshippable `awaitInput` resume, make the visual builder work on the desktop, and fix loop/validation correctness.

  **`awaitInput` is gated (was a hang-forever dead-end).** The executor can pause + checkpoint an `awaitInput` step, but the resume trigger/channel that delivers the operator's reply never shipped to `main` — `resumeWorkflowRun` had zero production callers. So an agent-drafted "ask me, then act" workflow would pause forever, leak a retained child session for the process lifetime, and orphan a checkpoint file. `awaitInput` is now **rejected at validate/save time** with a clear "requires the resume channel, not available in this build" message, and `draft.ts` no longer teaches it (it steers the author to `inputs` fields instead). Defense-in-depth: the CLI runner treats a `paused` result as non-terminal (no inbox delivery), `Session.close()` clears retained child sessions so they can't leak, and a `WorkflowRunStore.sweepStale()` sweeper (7-day TTL, run on workflows boot) reaps orphaned `~/.moxxy/workflow-runs/active/` checkpoints. The executor pause/resume path is kept intact so re-enabling is a matter of landing a resume trigger and removing the schema gate.

  **Visual builder works on the desktop now.** The desktop drives a `RemoteSession`, whose workflows view only forwarded `list`/`setEnabled`/`run` — so the builder's `validateDraft`/`save`/`getRun` were `undefined` and threw "not supported on this session". Added a `workflow.validateDraft|save|getRun` runner-RPC family (**protocol bumped to v4**) with RemoteSession client methods + server handlers, so the desktop builder validates/saves/loads against the runner.

  **Loop + validation correctness.** A condition/switch step used as a loop body is rejected (its branch routing was silently ignored). A non-loop-body step that `needs` a loop-body step is rejected (it would stall — body steps are excluded from the main DAG). A loop-body step's own `when` guard and any `needs` other than its loop step / a sibling body step are rejected (body steps run unconditionally each iteration). Logic-step `vars` now drop `__proto__`/`constructor`/`prototype` keys (prototype-pollution guard). Paused-run checkpoints persist + restore `vars` set before the pause. Renaming a workflow via the builder removes the old file/entry instead of leaving an orphaned duplicate (`save(workflow, previousName)`, threaded through the view → IPC → runner RPC → builder hook).

- 6afc4c0: Workflows engine (phase 1 of 2): port the logic-step + agentic-authoring engine onto current main, and add a bounded while-loop node.

  **Engine features ported.** `@moxxy/plugin-workflows` now supports logic steps — `bridge` (extract/transform upstream output into `vars`), `condition` (if/else gate routed by an LLM `{"branch":"then"|"else"}`), and `switch` (multi-way gate routed by case id) — plus a `format: json|plain` field, branch fields (`then`/`else`/`cases`/`default`), a persisted-only `ui.layout` schema (node x/y + viewport, no editor here), agentic YAML authoring (`draft.ts` `buildSystemPrompt`/`draftWorkflow` + the `workflow_create` tool teaching the full schema), LLM branch-predicate parsing (`logic-response.ts`), and `awaitInput` pause/resume for prompt/skill steps (`run-store.ts` checkpoints under `~/.moxxy/workflow-runs/active/` + executor `resumeWorkflowRun`). The DAG executor (`executor/dag.ts`) gains `runLogicStep`, `mergeVars`, `applyBranchSkips`, and an `ExecutorContext`, merged surgically onto main's baseline — main's `MAX_NESTING_DEPTH` guard and behavior are preserved, as is the CLI's separate inter-workflow `afterWorkflow` cycle guard (`MAX_AFTER_WORKFLOW_CHAIN`, Tarjan SCC). The SDK gains the matching types (`WorkflowLoopAction`, `WorkflowLogicStepFormat`, `WorkflowRunStatus`, `WorkflowUi*`, `awaitInput`, `retainSession`, `SubagentContinueArgs`); core's subagent runtime gains retained-session `continue()`/`release()` (new `run-child.ts` + `registry.ts`) backing the pause/resume flow.

  **New `loop` node.** A `loop: { body: string[], condition: string, maxIterations: 1..50 (default 10) }` action repeats its body steps in order each iteration (resetting their state per pass, honoring `onError`), then evaluates `condition` via the same LLM predicate as a `condition` step. `condition` is the loop's EXIT/GOAL condition — the body repeats UNTIL it is met: `then` = condition met → STOP (continue to the next step), `else` = not yet met → run another iteration. A body step error BREAKS the loop to the next step (the loop returns ok with a "broke on error" note rather than failing the whole workflow), unless that body step sets `onError: continue` (which swallows the error and keeps iterating). It is unmistakably safe: it terminates when the exit condition is met, when a body error breaks it, OR at `maxIterations` (finishing with a clear note, never hanging), and composes with `MAX_NESTING_DEPTH` (a body that calls nested workflows still bottoms out at the depth cap). The iteration cap and the depth cap are independent guards; neither can be defeated by the other. Schema rejects loops combined with `then`/`else`/`cases`/`default`, empty bodies, out-of-range `maxIterations`, unresolvable body ids, and `awaitInput` on a loop.

  **IPC for the upcoming visual builder (phase 2).** Additive, capability-detectable commands `workflows.validateDraft` (parse YAML → errors), `workflows.save` (persist a workflow), and `workflows.getRun` (fetch canonical YAML): zod-validated contract + a desktop-host pass-through handler + new optional `WorkflowsView` methods, with the mobile `MobileSessionHost` extended to parity. The visual builder GUI itself is phase 2 (follow-up).

## 0.8.1

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

- cf2f651: Performance pack from the 2026-06-09 audit (A39–A42 + A42b): the TUI context meter caches its token estimate per log and folds in only new events instead of re-walking the entire event log (incl. JSON.stringify of every tool result) on every ~30Hz render; the desktop NDJSON chat log keeps a size/mtime-guarded line-offset index so scroll-up pages seek-read only their own byte range instead of re-reading and re-parsing the whole file per page; MemoryStore maintains its MEMORY.md index incrementally (no more O(N) re-read of every memory file per write) and gains a warn-only `maxMemories` soft cap (default 500 — no eviction, memories are user knowledge); goal mode declares its idle nudge as a volatile tail message and the stable-prefix cache strategy places its rolling tail breakpoint before volatile messages, so idle goal iterations re-read the cached prefix instead of paying a guaranteed-wasted cache write; and compactor-summarize now produces a real summary via the session's own provider/model (new optional `provider`/`model` on `CompactContext`), falls back to an honest, clearly-labeled head+tail digest when no provider is reachable, and reports `tokensSaved` from real character deltas instead of the fabricated `slice.length * 30`.
- cf2f651: Provider-parity fixes from the 2026-06-09 audit (A36–A38):

  - **Codex (A36):** `req.maxTokens` now reaches the Responses API as `max_output_tokens`; `req.temperature` is documented-unsupported on the Codex backend (gpt-5 reasoning models reject sampling params) and dropped with a one-shot MOXXY_DEBUG note instead of silently; `reasoningEffort` is a live `CodexProviderConfig` option (was pinned to 'medium') and the CLI's codex credential resolver now passes `provider.config` through to the client instead of discarding it.
  - **Runtime openai-compat providers (A37):** registered vendors now report their own name + model catalog on the live client (usage stats / errors / context-window lookups no longer misattributed to 'openai'); vault/env key naming is unified behind `providerApiKeyName`/`storedProviderApiKeyName` in plugin-provider-admin — the CLI honors a stored `envVar` override and maps hyphens to underscores, matching the desktop; `provider_add` model descriptors can declare `supportsDocuments` so attachments stop degrading.
  - **`req.system` contract (A38):** hook-injected system text (e.g. plugin-memory's consolidation nudge) now actually reaches every provider — delivered in addition to system-role messages (anthropic: extra system block after the cache breakpoint; openai: inserted system message; codex: appended to `instructions`). The loop helpers no longer prefill `req.system` with the system prompt, which also removes a duplicated base prompt in codex `instructions`.

- cf2f651: Security: four audit leftovers (A43–A46). MCP server credentials now support `${vault:NAME}` placeholders in env/header values, resolved only at connect time (the persisted mcp.json and the model-visible tool args keep the placeholder; `mcp_add_server`/`mcp_test_server` instruct vault-first). Agent-view URLs are scheme-allow-listed (`https`/`http`/`mailto`/`tel` + relative; `data:image/*` for img src only) at BOTH walls: a canonical `isSafeViewUrl` in the sdk enforced by `parseView` and `validateDoc`, and a render-time re-check in the web frontend that neutralizes `javascript:`/`data:text` hrefs and srcs. `web_fetch` closes its DNS-rebinding TOCTOU by pinning every hop's connection to the SSRF-guard-vetted addresses via an undici dispatcher with a fixed lookup (SNI/cert validation intact). Telegram inline-keyboard callbacks now enforce the same pairing authorization gate as text/voice messages.

## 0.8.0

### Minor Changes

- 2e4bc37: Goal-mode auto-approve now respects user permission policy (audit A3). `PermissionResolver` gains an optional prompt-free `policyCheck(call, ctx)` (implemented by core's policy wrapper) that returns the engine/tool-rule decision without ever falling through to an interactive prompt. Goal mode consults it before auto-allowing, so `~/.moxxy/permissions.json` deny rules now deny in unattended runs — previously the auto-approve resolver replaced the whole policy chain, silently ignoring them.

### Patch Changes

- 0326fb0: Event-log and session-persistence hardening (audit wave 5):

  - `EventLog.ingest` no longer leaks async listener rejections as unhandled rejections — they are swallowed under the same non-fatal policy as `append()`.
  - Session event-log write failures are no longer silent: one structured warning per failure streak (path + error), a `SessionPersistence.degraded` flag, and a recovery log once writes succeed again.
  - `restoreEvents` re-sequences restored events to contiguous seq 0..n-1 around corrupt JSONL lines (warning with skip/re-sequence counts) and atomically repairs the on-disk file, so a single corrupt middle line no longer truncates attached-client replay or causes seq collisions on new appends.
  - `projectMessages` skips empty/whitespace-only assistant text blocks (keeping tool_use blocks), so tool-only turns — including historical wedged logs — no longer produce empty text blocks that providers reject.

- f3c798f: `/new` now truly resets the session everywhere (audit A10). New `session.reset` runner RPC (protocol v3) + optional `SessionLike.reset()` capability: the runner aborts in-flight turns and clears its authoritative event log; the log's new `EventLog.onClear` listeners broadcast a `session.reset` notification so every attached mirror clears in lockstep (re-arming seq-0 ingest instead of silently rejecting all further events) and truncate the persisted session JSONL so wiped history can't resurrect on `--resume` — fixing the same resurrection bug for local `/new`. The TUI and Telegram `/new` paths call `reset()` (falling back to `log.clear()` when the capability is absent) and report an error instead of claiming "history cleared" when the reset RPC fails.
- 0326fb0: Harden the desktop/mobile WebSocket bridge (2026-06-09 audit, wave 5):

  - Reject browser-Origin upgrades unless allow-listed (`allowedOrigins`, default deny; native clients are unaffected).
  - Move the pairing token out of the URL: `Authorization: Bearer` or a `Sec-WebSocket-Protocol` bearer entry are the supported presentations; the legacy `?t=` query is opt-in (`allowQueryToken`, kept on only for the mobile channel's already-paired apps). The QR still carries the token, but the app strips it before connecting.
  - Token rotation end to end: `rotateChannelToken` (sdk, persisted with `createdAt` + 90-day staleness warning), `rotateAuthToken` on the live server (drops existing connections), `rotateWsBridgeToken` (desktop) and `MobileChannel.rotateToken`.
  - Backpressure + lifecycle: connection cap (default 8), slow-reader eviction (backlog above 4 MB past a 10s grace terminates the socket), and `close()` now terminates clients so desktop quit doesn't burn its shutdown timeout.
  - `WsRpcClient` no longer replays abandoned requests after reconnect (outbox cleared, queued requests rejected on disconnect) and stops reconnecting after a capped exponential backoff, surfacing a terminal `disconnected` status.
  - Hygiene: empty `MOXXY_WS_PORT` no longer binds an ephemeral port, the server reports the actually-bound port, and the desktop bridge reuses the shared sdk token persistence (userData location kept).

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

## 0.6.0

### Minor Changes

- eac83e5: Hoist the duplicated tool-batch loop scaffolding out of `mode-default` and `mode-goal`
  into shared SDK helpers, so the load-bearing stuck-loop orphan-result fix lives in one
  place instead of being hand-mirrored across modes. `@moxxy/sdk` now exports
  `executeToolUses` (run a tool batch, synthesizing failed results + an abort on
  mid-batch cancel) and `emitRequestsAndDetectStuck` (emit `tool_call_requested`s, run the
  stuck detector, and on a trip synthesize a paired `tool_result` for every emitted call
  before the fatal error), parameterized by a `StuckLoopReport` for each mode's wording and
  goal mode's extra `goal_stuck` event. Pure refactor — no behavior change.

## 0.5.1

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

- e64aa0e: Fix "Mode not registered: tool-use" after the mode rename. A mode name persisted
  anywhere (config `mode:`, `~/.moxxy/preferences.json`, a desktop workspace's
  stored mode, a runner `setMode` RPC, a mid-turn mode hand-off) is now funneled
  through a legacy-name map in `ModeRegistry.setActive`: it tries the literal name
  first and falls back to the current name (`tool-use`→`default`,
  `deep-research`→`research`; the removed `plan-execute`/`bmad`/`developer` →
  `default`). A validly-registered name is never overridden, and a genuinely
  unknown mode still throws. Exposes `migrateModeName(name)` from `@moxxy/sdk`.

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

## 0.3.0

### Minor Changes

- d362a6b: Support sending documents (PDFs, Office/text) to the model. Adds a `document`
  `ContentBlock`, a `supportsDocuments` flag on `ModelDescriptor`, and a
  `'document'` `UserPromptAttachment` kind; `projectMessages` routes document
  attachments to the native block. The Anthropic, OpenAI, and Codex providers
  translate documents to their native shapes (Anthropic `document`, OpenAI
  `file`, Responses `input_file`), so attached files now reach the model for
  analysis instead of being dropped.

## 0.2.0

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

## 0.1.3

### Patch Changes

- 93d9a2d: Publish with `pnpm publish` instead of `npm publish` so pnpm's `workspace:*` and `catalog:` protocols are rewritten to concrete version ranges in the published `package.json`.

  The previous `npm publish` shipped those protocols verbatim, so `npx @moxxy/cli init` failed on a clean machine with:

  ```
  npm error code EUNSUPPORTEDPROTOCOL
  npm error Unsupported URL Type "workspace:": workspace:*
  ```

  Both `@moxxy/cli` (`dependencies."@moxxy/sdk": "workspace:*"`, `zod: "catalog:"`) and `@moxxy/sdk` (`peerDependencies.zod: "catalog:"`) were affected, so both are republished.

## 0.1.0

### Minor Changes

- c4352f9: First published release of the `moxxy` CLI and SDK (off the `0.0.0` placeholder).
