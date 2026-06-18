# Moxxy quality + performance sweep — consolidated synthesis (2026-06-18)

## Executive summary

This report consolidates the **complete** repo-wide quality + performance audit — all **140 raw shard files** (132 per-unit find/verify shards, 8 of them empty, plus all 11 cross-cutting sweeps). After dropping the **21 refuted** findings, **636 findings** survive; deduped (sweep-vs-unit and overlapping unit shards merged) and grouped into **41 clusters**: **10 Tier-1 (execute-first)**, **21 Tier-2 (care + tests)**, and **10 Tier-3 (propose-only)**.

> This supersedes the earlier `*.SWEEP-ONLY.*` artifacts, which synthesized only 8 of 11 sweeps and none of the unit shards.

The standout, executable-now themes:

1. **~500 LOC of proven-dead code is removable now** — the entire CDP screencast cluster in `plugin-browser` (orphaned by the PR #205 polling revert, already in TECH_DEBT) plus ~24 zero-consumer exports across core/cli/desktop/sdk. All typecheck-gated, invariant-#11 dynamic-dispatch checks done.
2. **Invariant #5 (atomic write + per-instance mutex) is unevenly applied** — five whole-file JSON stores reimplement the mutex+atomic+zod+quarantine pattern by hand, three boot/update paths re-roll a *sync* tmp+rename (no `writeFileAtomicSync` in the SDK), and ~18 read-modify-write stores have no mutex (preferences.json, plugins-admin config.yaml, chat-log NDJSON, tunnel-settings, channel-auth, config_set, runner provider-toggle…). One Tier-2 block extraction + one SDK helper centralize this.
3. **The chat-model block fold is O(n²) per turn on both surfaces** — desktop `Transcript` and TUI `ChatView` re-fold the entire growing event log via `pairToolEvents` on every committed event, and the live in-memory log / `seenIds` Set never evict. Highest-value perf item; Tier-2 because the fold output is load-bearing and needs golden tests first.
4. **Eight registries and five JSON stores are byte-for-byte copy-paste** whose own doc-comments say "Mirrors X" — two generic-base extractions centralize correctness in one tested place.
5. **Confirmed security/correctness defects rode in on the quality sweep** — `isSafeViewUrl` whitespace XSS bypass, broker SSRF via redirect-follow + symlink/TOCTOU + unbounded buffering, a permission-engine invalid-regex *fail-open*, OAuth token-refresh races, and ~50 other independently-confirmed bugs. Grouped into targeted Tier-2 clusters, each shipping with a regression test.
6. **The @moxxy/sdk barrel leaks Node builtins into the browser/RN surface** by static re-export, held safe today only by `import type` discipline, and dep-cruiser does not even cruise the renderer or mobile-poc. A `./server` subpath split + widened dep-cruiser scope closes the gap.

## Headline metrics

| Metric | Value |
|---|---|
| Raw shard files consumed | 140 (132 unit shards + 11 sweeps; 8 empty) |
| Findings after dropping refuted | 636 (21 refuted dropped; 2 needs-info kept+flagged) |
| Independently confirmed | 205 |
| unverified-lowrisk | 312 |
| sweep (treated confirmed) / unverified | 117 |
| Clusters | 41 |
| Tier 1 (execute-first) | 10 clusters / 58 findings |
| Tier 2 (care + tests) | 21 clusters / 186 findings |
| Tier 3 (propose-only) | 10 clusters / 392 findings |

**By lens:** review 228, test-gap 107, consistency 96, perf 73, deadcode 49, atomicity 30, types 27, completion 14, duplication 12

**By severity:** low 410, medium 196, high 30

**Top packages (by finding count):**

| Package | Findings |
|---|---|
| `apps/desktop` | 74 |
| `packages/core` | 61 |
| `packages/cli` | 48 |
| `packages/desktop-host` | 43 |
| `packages/plugin-cli` | 35 |
| `packages/sdk` | 25 |
| `packages/plugin-workflows` | 21 |
| `packages/client-core` | 20 |
| `packages/runner` | 17 |
| `packages/plugin-telegram` | 16 |
| `packages/plugin-oauth` | 15 |
| `packages/plugin-memory` | 14 |
| `packages/plugin-browser` | 13 |
| `packages/chat-model` | 11 |
| `packages/plugin-security` | 11 |

### Invariant check

Every cluster was screened against the 11 repo invariants. No cluster recommends a change that violates one. Specific guards: the `createJsonFileStore` / `writeFileAtomicSync` / `defineOpenAICompatProvider` / `collectProviderStream` extractions all land in `@moxxy/sdk` or a provider plugin **without** giving the SDK an internal dep (inv. #1) and **without** any core→plugin import (inv. #2); the elision/event-log perf work preserves compaction high-water marks (inv. #6) and CacheStrategy determinism (inv. #7); every dead-code deletion was re-checked for dynamic/string-keyed dispatch (inv. #11); and the `as unknown as` cleanups directly serve inv. #10. **Two `needs-info` findings are flagged, not actioned:** `u41-2` (jiti cwd singleton — no current multi-cwd caller reaches the bug) and `u73-3` (unbounded views Map — true only for un-named views; the proposed fix was judged wrong by the verifier). Both are parked in the long-tail buckets with their caveat intact.

---

## Tier 1 — execute-first (safe, high-value, low behavioral risk)

### [t1-deadcode-screencast] Remove the dead CDP screencast plumbing in plugin-browser

- **Lens:** deadcode | **Risk:** low | **Effort:** M | **Findings merged:** 3
- **Packages:** packages/plugin-browser

**What / why:** Delete the entire CDP screencast push cluster (dispatch cases, CDPSession type, sidecar emit wiring, browser-session onEvent channel) orphaned by the PR #205 polling revert.

**Rationale / risk:** Confirmed dead by repo-wide grep (callers only inside plugin-browser + dist artifacts); already journaled in TECH_DEBT as dormant debt. ~57 lines + ~9 cross-file symbols. Typecheck-gated, no test covers the removed path.

**Affected files & merged findings:**

- **[deadcode-global-1 · deadcode/medium/unverified]** Entire CDP screencast plumbing in plugin-browser is dead (no caller after polling revert)
  - Files: `packages/plugin-browser/src/sidecar/dispatch.ts; packages/plugin-browser/src/sidecar/types.ts; packages/plugin-browser/src/sidecar.ts; packages/plugin-browser/src/browser-session.ts` (Ldispatch.ts:12,28-36,52-77,206-239; types.ts:69-75,86-88; sidecar.ts:90-94; browser-session.ts:107-132,200-210,407-414)
  - Fix: Delete the two screencast dispatch cases + stopScreencast() helper + cdp/emit SidecarState fields + the stopScreencast() call in teardown(); remove the CDPSession interface and newCDPSession from PlaywrightHandle in types.ts; drop the state.emit assignment in sidecar.ts main(); remove onEvent/eventListeners/browserSidecarOnEvent and the unsolicited-event branch in handleLine from browser-session.ts. If screencast is ever revived, re-add it gated behind a polling fallback (TECH_DEBT note).
  - Test: Run plugin-browser unit tests; the screencast path has no test, so removal only needs the existing goto/screenshot/eval suite green plus `pnpm build` typecheck (CDPSession type import drops).
- **[u68-1 · deadcode/medium/confirmed]** Dormant screencast event-push plumbing: onEvent/eventListeners/browserSidecarOnEvent has no consumer
  - Files: `packages/plugin-browser/src/browser-session.ts` (L108-132, 200-210, 407-414)
  - Fix: Delete `eventListeners`, `onEvent()`, `browserSidecarOnEvent()`, the `reply.event && !reply.id` branch in handleLine, and the corresponding export in index.ts. Keep the sidecar-side `startScreencast`/`stopScreencast` (unit 69) only if a future push path is planned; otherwise remove that too in a coordinated change. Document the polling decision so the plumbing isn't re-added.
  - Test: Build + typecheck the package; existing browser-session.test.ts (sidecar protocol) and web-fetch tests must stay green. Grep CI guard that browserSidecarOnEvent has no importer.
- **[u69-1 · deadcode/medium/confirmed]** Dormant CDP screencast push path — startScreencast/stopScreencast/emit/cdp never invoked
  - Files: `packages/plugin-browser/src/sidecar/dispatch.ts; packages/plugin-browser/src/sidecar/types.ts` (L206-239)
  - Fix: Remove the `startScreencast`/`stopScreencast` cases, the `emit`/`cdp` fields on SidecarState, the `stopScreencast` helper, the `CDPSession`/`newCDPSession` types, and `state.emit` wiring in sidecar.ts plus `browserSidecarOnEvent`/`onEvent` in browser-session.ts — OR, if the surface is expected to re-adopt screencast, leave a single TODO and a test pinning the polling decision. teardown() should drop its now-unconditional `stopScreencast(state)` call.
  - Test: After removal, `pnpm build` + run dispatch.test.ts and browser-session.test.ts; assert browser-surface polling still emits frames via the `frame` method.

### [t1-deadcode-oneref] Delete one-reference / zero-consumer dead exports across the repo

- **Lens:** deadcode | **Risk:** low | **Effort:** M | **Findings merged:** 25
- **Packages:** apps/desktop, packages/cli, packages/core, packages/desktop-ipc-contract, packages/mode-deep-research, packages/plugin-cli, packages/plugin-computer-control, packages/plugin-terminal, packages/runner, packages/testing

**What / why:** Remove ~13 proven-unused exports: REMOTE_DISALLOWED_COMMANDS, runProcessBinary, deep-research constants, formatRequirementIssues, isOAuthProvider, printWarn, accentWash, useLatestDeepLink, schedulerLogPath, homeCwd, countNodes(core), SkillRouter/buildSkillIndexPrompt, PhaseMarker, testing matchers, killAndUnlinkRunner export, WORKFLOW_ERROR_KEY re-export.

**Rationale / risk:** Each verified by repo-wide grep (only the definition, no static/dynamic importer; invariant #11 dynamic-dispatch check performed). Pure deletions, typecheck-gated. Several flagged @deprecated and hand-maintained for no effect.

**Affected files & merged findings:**

- **[deadcode-global-2 · deadcode/low/unverified]** REMOTE_DISALLOWED_COMMANDS is a deprecated export with no code consumer
  - Files: `packages/desktop-ipc-contract/src/index.ts` (L1085-1110)
  - Fix: Delete the `REMOTE_DISALLOWED_COMMANDS` export (and its trailing maintenance burden). If a renderer ever needs affordance-gating, derive it from REMOTE_ALLOWED_COMMANDS instead.
  - Test: pnpm build typecheck across the monorepo (no importer to break); desktop-ipc-contract tests stay green.
- **[deadcode-global-3 · deadcode/low/unverified]** runProcessBinary is dead — its stated consumer (screenshot tool) migrated to runProcess + temp file
  - Files: `packages/plugin-computer-control/src/shell.ts` (L92-145)
  - Fix: Delete `runProcessBinary` (~52 lines). Its sibling runProcess remains the live primitive.
  - Test: plugin-computer-control tools.test.ts stays green; build typecheck confirms no importer.
- **[deadcode-global-4 · deadcode/low/unverified]** Three deep-research constants (MIN_SUBAGENTS, PLANNING_/SYNTHESIS_MAX_ITERATIONS) are unreferenced
  - Files: `packages/mode-deep-research/src/constants.ts` (L119-132)
  - Fix: Delete the three unused constant declarations.
  - Test: mode-deep-research tests + build typecheck; no importer.
- **[deadcode-global-5 · deadcode/low/unverified]** core requirements.ts exports formatRequirementIssues with no caller and no barrel re-export
  - Files: `packages/core/src/requirements.ts` (L57)
  - Fix: Delete `formatRequirementIssues` (and any now-unused helpers it alone pulls in).
  - Test: core test suite + build typecheck; no importer to break.
- **[deadcode-global-6 · deadcode/low/unverified]** cli wizard isOAuthProvider helper is unused
  - Files: `packages/cli/src/wizard/auth-context.ts` (L105)
  - Fix: Delete `isOAuthProvider`.
  - Test: cli build typecheck + wizard tests; no importer.
- **[deadcode-global-7 · deadcode/low/unverified]** printWarn is an unused sibling of the live printError
  - Files: `packages/cli/src/errors.ts` (L16-18)
  - Fix: Delete `printWarn` (re-add if a warn path ever needs it).
  - Test: cli build typecheck; no importer.
- **[deadcode-global-8 · deadcode/low/unverified]** accentWash (translucent node-card wash) is unused; only accentHex is consumed
  - Files: `apps/desktop/src/workflows/accents.ts` (L23-25)
  - Fix: Delete `accentWash`.
  - Test: desktop build/typecheck; no importer.
- **[deadcode-global-9 · deadcode/low/unverified]** useLatestDeepLink hook is unused (DeepLinkBridge is the live consumer)
  - Files: `apps/desktop/src/lib/useDeepLink.ts` (L70-72)
  - Fix: Delete `useLatestDeepLink`. (Optionally drop the now-internal-only `export` on deepLinkStore too.)
  - Test: desktop build/typecheck; no importer.
- **[deadcode-global-10 · deadcode/low/unverified]** schedulerLogPath() is exported but never called
  - Files: `packages/cli/src/commands/schedule-daemon-svc.ts` (L49-51)
  - Fix: Delete `schedulerLogPath`.
  - Test: cli build/typecheck; no importer.
- **[deadcode-global-11 · deadcode/low/unverified]** homeCwd() default-cwd helper in plugin-terminal is unused
  - Files: `packages/plugin-terminal/src/pty.ts` (L189-192)
  - Fix: Delete `homeCwd` (callers that need a default cwd already use os.homedir() directly or the spawn default).
  - Test: plugin-terminal build/typecheck; no importer.
- **[u59-1 · deadcode/medium/confirmed]** REMOTE_DISALLOWED_COMMANDS is a deprecated security export with zero code consumers and is stale
  - Files: `packages/desktop-ipc-contract/src/index.ts` (L1085-1112)
  - Fix: Delete the export (and its JSDoc). If affordance-gating is desired, derive it once at the call site as `IpcCommandName[]` minus REMOTE_ALLOWED_COMMANDS rather than maintaining a hand-curated, drift-prone second list.
  - Test: Remove the export; `tsc` across the workspace stays green (no static importers); add a guard test asserting the renderer affordance helper derives host-only commands from REMOTE_ALLOWED_COMMANDS so the two can never drift.
- **[u46-1 · deadcode/medium/confirmed]** SkillRouter + buildSkillIndexPrompt are dead — runtime uses SDK helper + registry filter instead
  - Files: `packages/core/src/skills/router.ts` (L1-81)
  - Fix: Delete router.ts and its export line in skills/index.ts (and the re-export from core/index.ts) plus router.test.ts; OR, if a future classifier router is intended, fold its trigger-match logic into SkillRegistryImpl.filterByTriggers (already duplicated there) so there is one source of truth.
  - Test: After deletion, run pnpm build + typecheck across the monorepo to confirm no consumer; grep confirms only the test referenced it.
- **[u50-1 · deadcode/medium/confirmed]** Exported countNodes in core is dead; plugin-view re-implements it because it can't import core
  - Files: `packages/core/src/view/parse.ts; packages/core/src/view/default-renderer.ts` (L505-509)
  - Fix: Move countNodes into @moxxy/sdk (e.g. alongside ViewNode in view-renderer.ts) as the single source of truth, have both core (if it still needs it) and plugin-view import it from the SDK, and drop the duplicate in plugin-view and the now-unused core export. Keeps invariant 1 (sdk zero-internal-deps; countNodes only touches the SDK's own ViewNode type).
  - Test: Keep parse-extended.test.ts's countNodes case but point it at the SDK export; add a plugin-view test asserting nodeCount uses the shared helper. Type-check ensures no remaining importer of the removed core export.
- **[u75-1 · deadcode/medium/confirmed]** PhaseMarker component is dead — no static or dynamic references anywhere in repo
  - Files: `packages/plugin-cli/src/components/PhaseMarker.tsx` (L5-26)
  - Fix: Delete PhaseMarker.tsx. If a phase-marker glyph row is desired in future, EventLine.tsx already renders the equivalent '◆ thinking' / file-edit rows.
  - Test: Build + typecheck the plugin-cli package after deletion; CI green confirms no importer existed.
- **[u127-1 · deadcode/medium/confirmed]** Vitest custom matchers (matchers.ts) are dead: zero importers of @moxxy/testing/matchers
  - Files: `packages/testing/src/matchers.ts` (L1-58)
  - Fix: Either (a) wire it up: add `import '@moxxy/testing/matchers'` to a shared vitest setupFiles entry (tooling/vitest-preset) and add type augmentation, then add at least one consuming test; or (b) delete matchers.ts and its './matchers' export and drop the 'Vitest matchers' claim from the package description. Given the package's purpose, (a) is preferable but requires real adoption; otherwise remove the dormant plumbing.
  - Test: If wired up, add a test that uses each matcher against a real EventLogReader and asserts pass/fail messages. If removed, CI build/typecheck confirms no broken imports.
- **[u120-3 · deadcode/low/confirmed]** killAndUnlinkRunner is `export`ed but never imported anywhere (only used internally)
  - Files: `packages/runner/src/remote-session.ts` (L961-970)
  - Fix: Drop the `export` keyword (make it a module-private function), or, if it is meant to be public recovery API, re-export it from index.ts and document it. Given no consumer, prefer making it private.
  - Test: After removing `export`, `pnpm build` + typecheck must stay green; confirm no test imports it.
- **[u15-5 · deadcode/low/confirmed]** Dead re-export of WORKFLOW_ERROR_KEY from WorkflowCanvas
  - Files: `apps/desktop/src/workflows/WorkflowCanvas.tsx` (L1330)
  - Fix: Delete the `import`-for-reexport of WORKFLOW_ERROR_KEY and the trailing `export { WORKFLOW_ERROR_KEY };`.
  - Test: Typecheck + existing WorkflowsPanel.test suite still green after removal.
- **[u8-1 · deadcode/low/confirmed]** useLatestDeepLink export is dead — zero consumers, dormant 'future routing' plumbing
  - Files: `apps/desktop/src/lib/useDeepLink.ts` (L69-72)
  - Fix: Either delete useLatestDeepLink + DeepLinkStore.last/latest() until a consumer exists (store just needs push/subscribe for the live-event invariant), or wire the intended routing consumer. Keeping it as documented dormant plumbing is acceptable only if explicitly tracked in TECH_DEBT.
  - Test: After removal, `pnpm --filter @moxxy/desktop typecheck` stays green; if kept, add a test that pushes a link and asserts useLatestDeepLink re-renders with it.
- **[u16-1 · deadcode/low/confirmed]** accentWash() is an unused export — no static or dynamic references
  - Files: `apps/desktop/src/workflows/accents.ts` (L23-26)
  - Fix: Delete the accentWash function (lines 23-26). It depends only on accentHex + the existing --color-card-bg CSS var, so removal is self-contained. If a translucent node wash is wanted later, reintroduce it at the call site.
  - Test: After deletion, run `pnpm -C apps/desktop typecheck` and the existing WorkflowsPanel.test.tsx; a knip/ts-prune dead-export check would also confirm no remaining importer.
- **[u24-4 · deadcode/low/confirmed]** Exported `schedulerLogPath()` has no consumers (static or dynamic)
  - Files: `packages/cli/src/commands/schedule-daemon-svc.ts` (L49-51)
  - Fix: Remove schedulerLogPath(); callers needing the path can use serviceLogPath(SCHEDULER_SERVICE) directly (the body it already delegates to).
  - Test: Remove and run build/typecheck/test for @moxxy/cli; no references should break.
- **[u26-1 · deadcode/low/confirmed]** printWarn export has zero callers anywhere in the repo
  - Files: `packages/cli/src/errors.ts` (L16-18)
  - Fix: Either delete `printWarn`, or adopt it at the existing ad-hoc warn sites (commands that currently do `process.stderr.write(colors.yellow(...))`). Prefer adoption to keep the consistent `warn:` tag, otherwise remove.
  - Test: If removed, `pnpm --filter @moxxy/cli typecheck` stays green (no consumers). If adopted, snapshot the stderr `warn:` prefix in one command test.
- **[u30-1 · deadcode/low/confirmed]** Exported isOAuthProvider() is dead — zero static or dynamic references repo-wide
  - Files: `packages/cli/src/wizard/auth-context.ts` (L104-107)
  - Fix: Delete isOAuthProvider, or — if a shared predicate is wanted — keep it and refactor the inline checks in init.ts/login.ts to call it. Removal is safest given no current consumers.
  - Test: After deletion, `pnpm build` + typecheck across the cli package confirms no broken import; grep confirms no remaining references.
- **[u65-1 · deadcode/low/confirmed]** Three exported constants are never referenced anywhere (dormant plumbing)
  - Files: `packages/mode-deep-research/src/constants.ts` (L119-132)
  - Fix: Delete MIN_SUBAGENTS, PLANNING_MAX_ITERATIONS, SYNTHESIS_MAX_ITERATIONS. If a real minimum-fanout floor is wanted, enforce MIN_SUBAGENTS in runPlanningPhase (refuse/pad plans below it); otherwise drop it.
  - Test: After deletion, `pnpm build` + typecheck the package; a knip/ts-prune pass should report zero unused exports in constants.ts.
- **[u112-1 · deadcode/low/confirmed]** homeCwd() is dead — exported from pty.ts but not in barrel and never called
  - Files: `packages/plugin-terminal/src/pty.ts` (L189-192)
  - Fix: Delete homeCwd() and the unused `import os from 'node:os'` it is the sole user of.
  - Test: Build/typecheck after removal; grep confirms zero references.
- **[u11-4 · deadcode/low/confirmed]** Unused `mono` prop on shared settings `Row` primitive
  - Files: `apps/desktop/src/settings/settings-primitives.tsx` (L94-144)
  - Fix: Remove the `mono` prop from `Row`'s signature and its className usage.
  - Test: tsc + existing settings render tests stay green after removal.

### [t1-searchbox-dup] Replace SkillGallery inline search markup with the shared SearchBox primitive

- **Lens:** duplication | **Risk:** low | **Effort:** S | **Findings merged:** 1
- **Packages:** apps/desktop

**What / why:** SkillGallery re-implements the settings SearchBox primitive byte-for-byte; import and delete ~28 lines of markup.

**Rationale / risk:** High-severity duplication already journaled in TECH_DEBT (2026-06-17). One-line replacement, guarantees visual parity with MCP/Vault/Providers tabs.

**Affected files & merged findings:**

- **[duplication-3 · duplication/high/unverified]** SkillGallery hand-rolls a near-verbatim copy of the shared settings SearchBox primitive
  - Files: `apps/desktop/src/settings/skills/SkillGallery.tsx; apps/desktop/src/settings/settings-primitives.tsx` (LSkillGallery 56-85; settings-primitives 13-52)
  - Fix: Import `SearchBox` from '../settings-primitives' (already imports EmptyState from there) and replace the inline block with `<SearchBox value={query} onChange={setQuery} placeholder="Search skills…" />`. Delete the duplicate markup. Exactly the fix described in TECH_DEBT.
  - Test: Render SkillGallery in jsdom, type into the search box, assert filtered cards; visual parity is guaranteed by sharing the primitive.

### [t1-blockshared-dup] Collapse copy-pasted desktop chat / TUI render helpers onto their shared modules

- **Lens:** consistency | **Risk:** low | **Effort:** S | **Findings merged:** 5
- **Packages:** apps/desktop, packages/client-core, packages/compactor-summarize, packages/desktop-host, packages/plugin-channel-web, packages/plugin-cli, packages/sdk, packages/testing

**What / why:** SkillGroupView re-defines pretty()/preStyle (and diverges on a background var); plugin-cli panels copy truncate()/oneLine() that chat-model already exports; render-diff reimplements the dep-free tool-display helpers; testing/compactor sites inline length/4 instead of estimateTextTokens; formatTokensShort duplicated with divergent rounding.

**Rationale / risk:** Pure helper-reuse fixes against an existing shared module; the SkillGroupView one also fixes a visible color inconsistency. All low-risk imports/deletes.

**Affected files & merged findings:**

- **[u1-1 · consistency/low/unverified-lowrisk]** SkillGroupView re-defines pretty() + preStyle instead of importing from blocks/block-shared.ts
  - Files: `apps/desktop/src/chat/SkillGroupView.tsx` (L201-230)
  - Fix: Delete the local `pretty` and `preStyle` from SkillGroupView.tsx and import them from './blocks/block-shared' (matching ToolBlock/SubagentView). This also unifies the expanded-body background color across all tool renderings.
  - Test: Snapshot/visual: render an expanded ToolRow inside SkillGroupView and a standalone ToolBlock; assert identical computed background on the expanded <pre>. Compile check passes after removing dead local helpers.
- **[u75-2 · consistency/medium/confirmed]** truncate() and oneLine() copy-pasted in 3 panel files; @moxxy/chat-model already exports both
  - Files: `packages/plugin-cli/src/components/SkillsPanel.tsx; packages/plugin-cli/src/components/ToolsPanel.tsx; packages/plugin-cli/src/components/WorkflowsPanel.tsx` (LSkillsPanel 158-164; ToolsPanel 144-150; WorkflowsPanel 260-266)
  - Fix: Import `truncate`/`oneLine` from '@moxxy/chat-model' in all three panels and delete the local copies; adjust the column arg by one (pass NAME_COL → NAME_COL-1 at the callsite, OR standardize chat-model's truncate to inclusive-of-ellipsis) so render width is unchanged.
  - Test: Snapshot/ink-testing-library render of each panel with a name longer than its column; assert the truncated string equals the pre-change output (guards the off-by-one width drift).
- **[duplication-4 · duplication/medium/unverified]** Web channel render-diff reimplements toDiffRows/fileDiffSummary/diffGutterNo/fileDiffVerb instead of the dep-free @moxxy/sdk/tool-display subpath
  - Files: `packages/plugin-channel-web/src/frontend/render-diff.tsx; packages/sdk/src/tool-display.ts` (Lrender-diff 13-34 (rowsOf/plusMinus/gutter/verb))
  - Fix: Import toDiffRows/fileDiffSummary (or the plusMinus helper)/diffGutterNo/fileDiffVerb from '@moxxy/sdk/tool-display' in render-diff.tsx and delete the local rowsOf/plusMinus/gutter/verb. Keep the DOM/CSS-class rendering local (that part is genuinely platform-specific).
  - Test: Snapshot the web FileDiffView output for a multi-hunk diff before/after; assert gap rows and gutter numbers match the SDK helpers' output.
- **[helper-reuse-5 · duplication/low/unverified]** Three sites inline `length / 4` token estimate instead of the SDK's estimateTextTokens
  - Files: `packages/desktop-host/src/attachments.ts; packages/testing/src/fake-provider.ts; packages/compactor-summarize/src/index.ts` (Lattachments.ts:171; fake-provider.ts:61; index.ts:103)
  - Fix: Replace `Math.round(fullText.length/4)` and `Math.ceil(blob.length/4)` with `estimateTextTokens(...)` imported from @moxxy/sdk. For compactor-summarize, compute `Math.max(0, estimateTextTokens(originalText) - estimateTextTokens(summary))` (or leave as a delta if exactness there is unimportant — lowest priority of the three).
  - Test: No behavior change beyond Math.round->Math.ceil for attachments; covered by existing attachment/fake-provider tests.
- **[u31-3 · consistency/low/unverified-lowrisk]** formatTokensShort duplicated in plugin-cli with divergent rounding (1.2k vs 1k, 812 vs 812)
  - Files: `packages/client-core/src/chat-store/usage.ts` (L37-42)
  - Fix: Move one canonical formatTokensShort into @moxxy/sdk (e.g. sdk/token-accounting or a format util) and import it from both client-core and plugin-cli; delete the two copies. Pick the desired rounding once.
  - Test: Snapshot table-test the shared formatter across {812, 1_200, 3_400_000}; assert both consumers import it.

### [t1-compareSemver-dup] Deduplicate compareSemver between cli/update and desktop-host/app-update

- **Lens:** consistency | **Risk:** low | **Effort:** S | **Findings merged:** 3
- **Packages:** packages/cli, packages/desktop-host

**What / why:** compareSemver is copied verbatim in two release paths; one copy drops prerelease/build suffix causing a non-deterministic latest tie-break. Hoist one tested impl.

**Rationale / risk:** Duplication + a latent correctness bug (release picker tie-break). Low risk; release-path so add a focused test.

**Affected files & merged findings:**

- **[u29-3 · consistency/low/unverified]** compareSemver duplicated verbatim between cli/update and desktop-host/app-update
  - Files: `packages/cli/src/update/check.ts` (L43-53)
  - Fix: Add compareSemver (and a parseSemver) to @moxxy/sdk and import it in both check.ts and resolve.ts, deleting both local copies. Respects invariant 3 (shared logic routed through @moxxy/sdk).
  - Test: Move the existing compareSemver test cases into the sdk test; assert both call sites still pass their suites.
- **[u52-2 · review/low/unverified-lowrisk]** compareSemver drops prerelease/build suffix → non-deterministic 'latest' tie-break in release picker
  - Files: `packages/desktop-host/src/app-update/resolve.ts; packages/desktop-host/src/app-update/stager.ts` (L235-248)
  - Fix: For the release picker, tie-break deterministically: when compareSemver returns 0, fall back to comparing the full tag string (or the release's published_at). Alternatively document/enforce that desktop-v tags are always bare x.y.z. The bootstrap/gate uses of compareSemver (>, <=) are unaffected and need no change.
  - Test: Unit test compareSemver returns 0 for 1.0.0 vs 1.0.0+b; test resolveDesktopRelease deterministically picks the intended tag when two same-core versions are present in either API order.
- **[u52-3 · consistency/low/unverified-lowrisk]** compareSemver is duplicated from packages/cli/src/update/check.ts
  - Files: `packages/desktop-host/src/app-update/resolve.ts` (L235-248)
  - Fix: Extract a single dependency-free `compareSemver` into a leaf util that both can import WITHOUT pulling electron/core — e.g. keep it in app-update (already dep-free) and have cli import from @moxxy/desktop-host/app-update, OR add it to @moxxy/sdk if a dep-free home is acceptable. Lowest-risk: leave as-is but add a code comment cross-referencing the twin and a shared test vector. Do NOT introduce a cycle or make sdk depend on anything.
  - Test: Shared table-driven test asserting both implementations agree on a fixed vector (until merged).

### [t1-types-casts] Replace banned as-unknown-as private-field pokes and unchecked casts (invariant #10)

- **Lens:** types | **Risk:** low | **Effort:** M | **Findings merged:** 8
- **Packages:** apps/desktop, packages/client-core, packages/core, packages/desktop-host, packages/plugin-browser, packages/plugin-provider-admin, packages/plugin-provider-zai

**What / why:** Remove gratuitous as-unknown-as double-casts on the child-session tools/childLog path, the runner-supervisor test private-field poke, provider config casts (zai/admin), synthAssistantMessage event fabrication, and the browser error-kind launder; introduce typed carriers/generics.

**Rationale / risk:** Invariant #10 explicitly bans (x as unknown as {f}).f = ...; these are type-safety-only changes with no behavior change. Risk only where the cast hid a real shape mismatch (verify each).

**Affected files & merged findings:**

- **[types-generics-7 · review/low/unverified]** Banned private-field poke `(sup as unknown as {child}).child = ...` in runner-supervisor test
  - Files: `packages/desktop-host/src/runner-supervisor.test.ts` (L120, 145)
  - Fix: Add a narrow test seam to RunnerSupervisor — either a constructor-injectable spawn factory (preferred, matches the defineX/DI style elsewhere) or a `__setChildForTest(proc)` method guarded by a comment — so the test stops poking the private field. Keeps the banned pattern at zero repo-wide.
  - Test: Existing supervisor tests pass through the new seam instead of the cast.
- **[types-generics-8 · types/low/unverified]** Two unchecked `as unknown as` casts widen ToolRegistry / EventLogReader on the child-session path
  - Files: `packages/core/src/subagents/run-child.ts` (L93, 385)
  - Fix: Make the source types structurally satisfy the target interfaces so a plain assignment (or at most a single `as ToolRegistry`) typechecks: either have ToolRegistry be the interface `parentSession.tools` already implements, or expose a `asReader()` on EventLog returning EventLogReader. If a runtime narrowing is truly needed, add a guard rather than a blind double-cast.
  - Test: Typecheck is the gate; existing subagent tests exercise the path.
- **[u47-3 · types/low/confirmed]** Gratuitous `as unknown as` double-casts on tools and childLog (invariant #10 smell)
  - Files: `packages/core/src/subagents/run-child.ts` (L90-93,385)
  - Fix: Drop both `as unknown as`: write `log: childLog` directly, and either `tools: toolRegistry` with `buildFilteredToolRegistry` returning the SDK type (it already does) and `parentSession.tools` (no cast) for the unfiltered branch. If a real structural mismatch remains, narrow it to a single `as ToolRegistry` with a comment, never `as unknown as`.
  - Test: tsc must still pass after removing the casts; the existing run-child.test.ts already exercises both filtered and unfiltered tool paths indirectly.
- **[u32-3 · types/low/confirmed]** synthAssistantMessage fabricates a MoxxyEvent via `as unknown as MoxxyEvent` double-cast
  - Files: `packages/client-core/src/chatModel.ts` (L351-363)
  - Fix: Use the SDK's event factory (or a typed makeAssistantMessage helper) to build the synthetic event with real ids/seq, eliminating the double cast. If no factory is exposed to the renderer, route the synthetic-event shape through a typed @moxxy/sdk helper so the field set stays in lockstep with MoxxyEvent.
  - Test: Type-level: removing the cast must compile against the real MoxxyEvent. Add a test asserting the committed turn_complete fallback event has a non-negative seq and matching turnId.
- **[u93-6 · types/low/confirmed]** Weak casts: onInit logger reach-through and createClient config double-cast
  - Files: `packages/plugin-provider-admin/src/index.ts; packages/plugin-provider-admin/src/factory.ts` (L316-316)
  - Fix: If PluginInitContext exposes a typed logger, use it directly; otherwise narrow with a small type guard. For createClient, type the config param via the provider's known config type (or the SDK's ProviderClientConfig) instead of an inline Record cast.
  - Test: Typecheck only — removing the cast should compile against the real ctx/config types; no runtime test needed.
- **[u102-3 · types/low/confirmed]** Unchecked `config as OpenAIProviderConfig` / `as AnthropicProviderConfig` casts
  - Files: `packages/plugin-provider-zai/src/index.ts` (L27-28, 55-56)
  - Fix: Narrow with a small runtime guard / zod parse of the known optional string fields (apiKey/baseURL/defaultModel) in the shared factory, or at minimum pick the known keys instead of a blanket cast.
  - Test: Unit test feeding createClient a config with a non-string baseURL and asserting it is rejected/ignored rather than passed through.
- **[u69-4 · types/low/confirmed]** Error `kind` laundered through `(err as Error & {kind?: string})` casts instead of a typed carrier
  - Files: `packages/plugin-browser/src/sidecar/dispatch.ts; packages/plugin-browser/src/sidecar/types.ts` (L82-89)
  - Fix: Introduce a small `class SidecarError extends Error { constructor(message, readonly kind: ErrorKind) }` carrier; throw it from badParams/install; in dispatch read `err instanceof SidecarError ? err.kind : 'unknown'`. Erases all the casts and makes `kind` type-checked.
  - Test: Type-only: a SidecarError with an invalid kind fails compilation; dispatch test asserts kind passthrough.
- **[u11-3 · types/low/confirmed]** Unchecked cast `(p as { supportsReasoning?: boolean })` reads a field absent from the typed contract
  - Files: `apps/desktop/src/settings/ProvidersTab.tsx` (L60-62)
  - Fix: Add `supportsReasoning?: boolean` to `ProviderEntry` in @moxxy/desktop-ipc-contract (and populate it on the runner side) so the access is typed, or delete the function with the dead UI (u11-2).
  - Test: Type-level: once the field exists on ProviderEntry, the cast is removable and `tsc` still passes.

### [t1-workflow-reducer-exhaustive] Make non-exhaustive switches explicit with assertNever

- **Lens:** types | **Risk:** low | **Effort:** S | **Findings merged:** 2
- **Packages:** packages/core, packages/workflows-builder

**What / why:** Workflow-builder reducer default:return state and RequirementChecker.targetInfo switch silently swallow new variants; add assertNever so new kinds fail at compile time.

**Rationale / risk:** Type-safety hardening, no runtime behavior change for existing variants.

**Affected files & merged findings:**

- **[types-generics-6 · types/low/unverified]** Workflow builder reducer `default: return state` hides non-exhaustive action handling
  - Files: `packages/workflows-builder/src/reducer.ts` (L54-95)
  - Fix: Replace `default: return state` with `default: return assertNever(action)` (the same SDK helper proposed in #5). If a genuinely-ignored action is intended, narrow it explicitly so the never-check still covers the rest.
  - Test: Compile-time: adding a union member without a case fails typecheck. Existing reducer tests unchanged.
- **[types-generics-5 · duplication/medium/unverified]** RequirementChecker.targetInfo switch repeats `registry.list().find(name)->{kind,name,active}` 8x and lacks an assertNever
  - Files: `packages/core/src/requirements.ts` (L150-201)
  - Fix: Two-part: (a) once the def/active registries share a base (#2/#4), give the base a `describe(name): {present:boolean; active:boolean}` so targetInfo collapses to a small kind->registry lookup table; (b) add a private `assertNever(x: never): never` helper in @moxxy/sdk and end every domain switch (this one, the workflows reducer) with `default: return assertNever(kind)` to make non-exhaustiveness a compile error. No assertNever helper exists anywhere in the repo today.
  - Test: Add a test that every RequirementKind has a table entry (drive it off the zod enum). assertNever is type-level (compile-time), no runtime test needed beyond a smoke case.

### [t1-leak-timers-listeners] Fix proven resource/timer/listener leaks (low behavioral risk)

- **Lens:** review | **Risk:** low | **Effort:** M | **Findings merged:** 6
- **Packages:** apps/desktop, packages/core, packages/isolator-subprocess, packages/isolator-wasm, packages/isolator-worker, packages/plugin-browser

**What / why:** Clear leaked timers and listeners: wasm isolator Promise.race 60s setTimeout+abort listener on every successful call; WorkflowCanvas rejectTimer not cleared on unmount; isolator-subprocess/worker broker handler .then without .catch; browser sidecar queue link missing .catch; session-persistence detach final write dropped after closed flag.

**Rationale / risk:** Each is a confirmed or sweep-confirmed leak/unhandled-rejection with an obvious bounded fix; no protocol or state-shape change.

**Affected files & merged findings:**

- **[u63-1 · review/high/confirmed]** Promise.race timeout leaks a 60s setTimeout (+ abort listener) on every successful wasm call
  - Files: `packages/isolator-wasm/src/index.ts` (L113-137)
  - Fix: Wrap invoke() in a try/finally (or use an explicit settled-guard like subprocess does): capture `timer` and `onAbort` in the outer scope and `clearTimeout(timer); signal.removeEventListener('abort', onAbort)` in a finally after the race settles. Simplest: `try { return await Promise.race([...]) } finally { clearTimeout(timer); signal.removeEventListener('abort', onAbort); }` with timer/onAbort hoisted out of the inner Promise.
  - Test: Add a vitest that runs a fast echo call, then asserts no pending timer keeps the loop alive (e.g. wrap with fake timers and assert `vi.getTimerCount()===0` after run resolves) and that `signal` has no residual 'abort' listeners (track via a spy AbortController or `signal.eventListeners`-equivalent).
- **[u15-4 · review/low/unverified-lowrisk]** rejectTimer setTimeout never cleared on unmount (post-unmount setState)
  - Files: `apps/desktop/src/workflows/WorkflowCanvas.tsx` (L147, 264-268)
  - Fix: Add `useEffect(() => () => { if (rejectTimer.current) clearTimeout(rejectTimer.current); }, []);`.
  - Test: Mount, trigger a cycle-rejected connect, unmount before 2600ms, assert no act() warning and clearTimeout called.
- **[async-error-2 · review/low/unverified]** Broker-request handler promise (`handleBrokerRequest(...).then(...)`) lacks a .catch in both isolators
  - Files: `packages/isolator-subprocess/src/index.ts; packages/isolator-worker/src/index.ts` (L283-291 (subprocess); 269-271 (worker))
  - Fix: Add a `.catch((err) => { /* report a broker-error response or log */ })` to both `.then` chains so the isolation broker path is defensively rejection-safe regardless of broker internals. Low effort, hardens a trust-boundary code path.
  - Test: Inject a broker stub that rejects; assert no unhandledRejection and that the sandboxed call still settles (error reply propagated).
- **[async-error-1 · review/medium/unverified]** Browser sidecar request queue has no .catch on its chain link — a sync write() throw poisons all subsequent requests
  - Files: `packages/plugin-browser/src/sidecar.ts` (L116-119)
  - Fix: Append `.catch((err) => { try { write({ id: req.id, ok: false, error: { message: errMsg(err), kind: 'runtime' } }); } catch {} })` to the chained link (or wrap the body in try/catch), so a write failure (i) can't poison the serialization queue and (ii) is logged/reported instead of becoming an unhandled rejection.
  - Test: Unit: stub `process.stdout.write` to throw once, push two requests; assert the second still gets dispatched (queue not poisoned) and no unhandledRejection fires.
- **[async-error-3 · review/low/unverified]** Session persistence detach() fires a final scheduleIndexWrite AFTER setting this.closed — debounced write may be silently dropped
  - Files: `packages/core/src/sessions/persistence.ts` (L127-134)
  - Fix: On detach, perform a synchronous/awaited final meta write (e.g. an immediate `void this.writeIndex()` bypassing the debounce, or expose an awaitable `flush()` the shutdown sequence can `await`) so the close-time metadata is durable. Alternatively have onShutdown await Session.close → persistence.flush().
  - Test: Attach, append one event, immediately call detach + simulate exit before 250ms; assert the meta sidecar on disk reflects the latest lastActivity/eventCount.
- **[async-error-4 · consistency/low/unverified]** Browser surface input() awaits sidecar calls but the swallowed-error .catch hides hard failures from the user
  - Files: `packages/plugin-browser/src/browser-surface.ts` (L93-104)
  - Fix: On an input-call rejection, `emit({ type: 'status', text: ... })` (at least for navigate, where an SSRF/format rejection is user-meaningful) instead of silently dropping, so a blocked navigation gives feedback.
  - Test: Stub browserSidecarCall('goto') to reject; assert a status payload is emitted to subscribers.

### [t1-runner-completedturns-leak] Evict completedTurns map on observer clients (unbounded growth)

- **Lens:** perf | **Risk:** low | **Effort:** S | **Findings merged:** 3
- **Packages:** packages/runner

**What / why:** completedTurns grows unbounded on observer clients (never evicted) and leaks an entry when a turn completes but runTurn never consumes it; bound/evict it.

**Rationale / risk:** Confirmed (u120-1 high). Contained map-eviction fix in remote-session; add a test asserting eviction after turn consume.

**Affected files & merged findings:**

- **[u120-1 · perf/high/confirmed]** completedTurns map grows unbounded on observer clients (never evicted)
  - Files: `packages/runner/src/remote-session.ts; packages/runner/src/server.ts` (L212-218)
  - Fix: Only stash into completedTurns when this client actually has (or is about to register) a turn for that id. Options: (a) cap completedTurns with an LRU / size bound and drop oldest; (b) only record turnIds the client itself started (track an `ownedTurns` set populated in runTurn before awaiting the reply, and ignore turn.complete for ids not in it); or (c) evict an entry after a short timeout if no stream claims it. Option (b) is cleanest and matches the documented intent ('turns that completed before their runTurn stream was registered').
  - Test: Integration test: attach an observer client, drive N turns from a driver client, assert the observer's `completedTurns` size stays bounded (expose a test hook or assert via memory). Also assert a fast local turn still completes (existing fast-turn path unbroken).
- **[complexity-hotspots-12 · review/low/unverified]** completedTurns map entry leaks when a turn completes but runTurn never consumes it
  - Files: `packages/runner/src/remote-session.ts` (L179, 200-215, 389-392)
  - Fix: Cap completedTurns to the last N turn ids (insertion-ordered Map drop-oldest like DeliveryDedupeCache) or clear it on disconnect alongside turnStreams; entries older than the active turn window are unreclaimable today.
  - Test: Drive many turn_complete notifications with no matching runTurn and assert completedTurns size stays bounded; confirm a legit fast-turn still gets its buffered completion.
- **[u120-5 · review/low/unverified-lowrisk]** runTurn priming order: completedTurns finish can race ahead of byTurn priming for a fast errored turn
  - Files: `packages/runner/src/remote-session.ts` (L455-458)
  - Fix: Document the ordering invariant explicitly, or make TurnStream.finish a deferred 'no more events after the queue drains AND the recorded completion' — i.e. only honor a completedTurns finish after re-draining byTurn at registration time (already done) and guard that the live Event handler's push for an already-finished turn is intentional/no-op. A short test that interleaves a late Event after turn.complete documents the contract.
  - Test: Drive a fake transport that delivers an Event frame AFTER the turn.complete frame for the same turn and assert the late event is either consistently delivered or consistently dropped per the documented contract.

### [t1-fakeprovider-bugs] Small correctness fixes in testing/util helpers

- **Lens:** review | **Risk:** low | **Effort:** S | **Findings merged:** 2
- **Packages:** packages/chat-model, packages/testing

**What / why:** fake-provider byHash miss silently consumes a script slot (cursor++); subagent_completed coerces missing tokensUsed to 0 masking unknown-as-zero.

**Rationale / risk:** Low-risk localized fixes that improve test fidelity and token accounting.

**Affected files & merged findings:**

- **[u127-5 · review/low/unverified-lowrisk]** byHash miss silently consumes a script slot (cursor++ even when byHash was the intended source)
  - Files: `packages/testing/src/fake-provider.ts` (L43-50)
  - Fix: Branch explicitly: if `byHash` is non-empty and lacks the hash, throw a byHash-specific error listing known hashes, without touching the cursor; only consume `script[this.cursor++]` when falling back to script mode. Optionally guard so a provider constructed with only byHash never advances the script cursor.
  - Test: Add a test: FakeProvider with byHash but no matching hash throws an error naming byHash and does not advance cursor; mixed script+byHash test asserts cursor only moves on script-served calls.
- **[u22-4 · review/low/unverified-lowrisk]** subagent_completed coerces a missing/invalid tokensUsed to 0, masking 'unknown' as 'zero tokens'
  - Files: `packages/chat-model/src/pair-events.ts` (L98-105)
  - Fix: Use `... ? payload.tokensUsed : null` so an unreported total stays null and the renderer omits the segment instead of showing a false 0/0.0k.
  - Test: Add a pair-events case: subagent_completed without tokensUsed -> block.tokensUsed === null (and formatTokensK(null)===null omits the row).

---

## Tier 2 — valuable, needs care + new tests

### [t2-chatmodel-fold-perf] Eliminate the O(n^2)/turn block fold in chat-model (desktop + TUI)

- **Lens:** perf | **Risk:** medium | **Effort:** L | **Findings merged:** 7
- **Packages:** apps/desktop, packages/chat-model, packages/client-core, packages/plugin-cli

**What / why:** Desktop Transcript and TUI ChatView re-fold the ENTIRE event log via pairToolEvents on every committed event; groupToolNodes/buildRenderNodes rebuild the whole render tree per render; countToolCalls/isSettled and the settled-prefix scan recurse the full tree per render. Incrementalize the fold (track a high-water mark, append-only) behind golden tests.

**Rationale / risk:** Single highest-value perf item; the fold output is load-bearing across every surface so it needs byte-identical golden tests before any incrementalization. Medium risk.

**Affected files & merged findings:**

- **[complexity-hotspots-1 · perf/high/unverified]** Desktop transcript re-folds the ENTIRE event log via pairToolEvents on every committed event
  - Files: `apps/desktop/src/chat/Transcript.tsx; packages/client-core/src/chatModel.ts; packages/chat-model/src/pair-events.ts` (LTranscript.tsx:84-87; chatModel.ts:285-306; pair-events.ts:92-309)
  - Fix: Make the fold incremental: keep a persisted folded block tree (the ChunkedBlockLog already supports O(1) append + findLast for outcome patching) and apply only the delta event in applyEvent, OR memoize pairToolEvents on a (log.version, prefixLength) high-water mark and reuse the settled-prefix blocks across calls (only re-fold the open/unsettled tail). The TUI's settledRef pattern is the model — push it down into the fold so the settled prefix is never re-walked.
  - Test: Unit-test an incremental fold against the existing pairToolEvents output for a recorded multi-tool turn (must be byte-identical block tree); add a perf assertion that folding event N+1 touches O(tail) not O(N) blocks.
- **[complexity-hotspots-2 · perf/high/unverified]** TUI ChatView re-folds the whole events array on every non-chunk event (same O(n^2)/turn as desktop)
  - Files: `packages/plugin-cli/src/components/ChatView.tsx; packages/plugin-cli/src/session/use-event-stream.ts; packages/chat-model/src/pair-events.ts` (LChatView.tsx:48-51; use-event-stream.ts:62; pair-events.ts:92-309)
  - Fix: Share the incremental-fold solution from finding 1 (the fold lives in @moxxy/chat-model, used by both surfaces). Maintain a folded block log keyed by event seq high-water mark; on a new event, fold just that one event onto the prior tree (append/patch-by-callId via ChunkedBlockLog.findLast).
  - Test: Golden-output test: incremental fold must equal pairToolEvents(full) after each event for several recorded turns (skill scopes, live-tools, subagents, orphan results); add a counter assertion that a 500-event turn does not perform 500 full walks.
- **[complexity-hotspots-6 · perf/low/unverified]** groupToolNodes + buildRenderNodes rebuild the whole render tree per render; extensions re-sorted each call
  - Files: `packages/client-core/src/chatModel.ts` (L65-86, 285-306)
  - Fix: Fold incrementally (finding 1) so groupToolNodes/buildRenderNodes operate on the appended tail; keep extensions pre-sorted (they're appended in afterCount order already, so the sort is usually a no-op — skip it when already ordered).
  - Test: Render-node golden test unchanged; assert extension ordering preserved without the per-call sort when appends are monotonic.
- **[complexity-hotspots-10 · perf/low/unverified]** TUI settled-prefix scan walks the full folded block list every render
  - Files: `packages/plugin-cli/src/components/ChatView.tsx` (L70-86)
  - Fix: Start the settled scan at `settledRef.current.length` (the prefix already known settled never un-settles), only advancing forward. Guard the existing shrink-detection (blocks.length < settledRef length) as today.
  - Test: Existing ChatView tests; add a case asserting the Static items match a from-scratch settled scan after many incremental renders.
- **[complexity-hotspots-11 · perf/low/unverified]** countToolCalls / isSettled recurse the full block tree; called per render on the full fold
  - Files: `packages/chat-model/src/pair-events.ts` (L375-383, 318-329)
  - Fix: Cache per-scope toolCall counts and a `settled` flag on the block once it closes (skill scopes/live-tools are sealed exactly once), so countToolCalls/isSettled short-circuit on already-settled subtrees.
  - Test: Equality test of cached vs recomputed counts/settled flags across a turn with nested skill scopes and live-tools.
- **[u32-1 · test-gap/medium/unverified-lowrisk]** groupToolNodes run-collapsing logic has no unit test
  - Files: `packages/client-core/src/chatModel.ts` (L66-93)
  - Fix: Add a chatModel.test.ts describe('groupToolNodes') covering: two consecutive non-diff tool blocks collapse to one tool-group with id `toolgroup:<first.id>`; a lone tool stays a block; a Write/Edit (FILE_DIFF_TOOL_NAMES) tool never folds; an assistant/ext node between tools breaks the run into two singletons; trailing run is flushed.
  - Test: Unit test against synthetic RenderNode arrays; assert kind/ids of the output sequence.
- **[u15-1 · perf/low/confirmed]** topoOrder + byId recompute on every pointer-move during a node drag
  - Files: `apps/desktop/src/workflows/WorkflowCanvas.tsx` (L164-167, 321-345)
  - Fix: Memoize topoOrder on a derived key that excludes geometry — e.g. a stable signature of (node.id, node.needs) joined — so position drags don't retrigger the fold. byId only needs node ids, so key it on ids too. Alternatively have moveNode keep node identity stable for everything but x/y and memo on a `needs`-only projection.
  - Test: Unit-test topoOrder directly (currently untested) for stability; add a render-count assertion in WorkflowsPanel.test that dragging a node does not recompute order (spy on a memoized selector).

### [t2-eventlog-elision-scans] Index EventLog and stop re-folding the whole log per provider call

- **Lens:** perf | **Risk:** medium | **Effort:** L | **Findings merged:** 8
- **Packages:** packages/core, packages/runner, packages/sdk

**What / why:** EventLog.ofType/byTurn are full-array filters with no index; applyLazyTools re-scans the full log every provider call; computeElisionState walks the log up to 4x/call (and sorts aged recalls every call); projectMessages does a linear range scan per event; estimateContextTokens re-folds the whole log per call. Add type/turn indexes + memoized elision state respecting compaction high-water marks (invariant #6).

**Rationale / risk:** Hot-path SDK/core perf touching the provider-call loop; must preserve compaction high-water-mark semantics and determinism. Medium risk, needs perf + equivalence tests.

**Affected files & merged findings:**

- **[complexity-hotspots-3 · perf/medium/unverified]** applyLazyTools re-scans the FULL event log (log.ofType filter) on every provider call when lazy tools are on
  - Files: `packages/sdk/src/tool-gating.ts; packages/sdk/src/mode-helpers.ts` (Ltool-gating.ts:33-43, 97-107; mode-helpers.ts:403-407)
  - Fix: Derive loaded-tool names incrementally: maintain a Set updated by an onEvent subscriber for tool_call_requested where name==='load_tool', or have ModeContext expose a cached loadedTools projection invalidated by log version. Alternatively give EventLog a typed index (Map<type, MoxxyEvent[]>) maintained on append so ofType is O(matches) not O(n).
  - Test: Verify loadedToolNames returns the same set via the incremental path for a log with interleaved load_tool calls; micro-bench applyLazyTools cost is flat as the log grows.
- **[complexity-hotspots-4 · perf/low/unverified]** EventLog.ofType / byTurn are full-array filters with no type/turn index
  - Files: `packages/core/src/events/log.ts` (L53-59)
  - Fix: Maintain a `Map<MoxxyEventType, MoxxyEvent[]>` and a `Map<TurnId, MoxxyEvent[]>` on append()/ingest() so ofType/byTurn are O(matches). Keep filter() as the fallback for cold/seeded logs (rebuild the index lazily on first query). Must preserve the seq-addressed semantics and the rebase/clear resets.
  - Test: Property test: indexed ofType/byTurn equal the filter result across append, ingest, rebase, clear; ensure index resets on clear() and rebase().
- **[complexity-hotspots-5 · perf/low/unverified]** projectMessages does eventInCompactionRange (linear range scan) per event inside the projection loop
  - Files: `packages/sdk/src/mode-helpers.ts` (L91-114, 234-247)
  - Fix: Compactions are non-overlapping ascending seq ranges — sort once and binary-search, or precompute a boundary cursor advanced alongside the event loop (both events and ranges are seq-ordered, so a single merge pass is O(events + ranges)).
  - Test: Existing projection golden tests must stay byte-identical; add a case with many compaction ranges and assert no behavioural change.
- **[complexity-hotspots-7 · perf/low/unverified]** computeElisionState walks the full log up to 4 times per provider call
  - Files: `packages/sdk/src/elision-state.ts` (L73-130)
  - Fix: Fuse passes 1-3 into a single loop (HWM can be found first, but the second/third can share one iteration). Memoize the sub-HWM portion keyed by (log.version, hwm) since events at/below the HWM never change — only the tail above the HWM and the latest ElisionEvent can shift the result.
  - Test: computeElisionState output must be identical pre/post fusion across the existing elision test fixtures (recall pinning, conversational stubs, caps).
- **[u122-2 · perf/low/confirmed]** estimateContextTokens re-folds whole log (computeElisionState x ~4 passes) per call
  - Files: `packages/sdk/src/compactor-helpers.ts; packages/sdk/src/elision-state.ts` (L27-57)
  - Fix: Have runElisionIfNeeded/runCompactionIfNeeded compute computeElisionState once and thread it into estimateContextTokens (add an optional precomputed-state param) and into projection within the same iteration, OR expose the plugin-cli incremental-fold cache from the SDK so every consumer shares one O(appended) estimator. At minimum, accept the elision-state as an arg to avoid the double computeElisionState per iteration.
  - Test: Spy on a shared eventChars/computeElisionState; assert it walks the log once per iteration, not 3x. Benchmark estimate over a 10k-event log to confirm it stays linear and not multiplied.
- **[u122-4 · perf/low/confirmed]** computeElisionState sorts aged recalls every call though recall results are rarely present
  - Files: `packages/sdk/src/elision-state.ts` (L124-134)
  - Fix: Short-circuit when recallResultCallIds.size === 0 (skip the filter/sort/loop entirely). When non-empty, walk events backward (seq-descending order is the append order reversed) accumulating bytes instead of allocating+sorting.
  - Test: Benchmark with a log containing no recalls (assert no sort) vs many recalls; unit test that unpinnedRecallCallIds is identical under both code paths.
- **[u125-2 · perf/low/confirmed]** applyLazyTools filters the tool list twice into complementary partitions
  - Files: `packages/sdk/src/tool-gating.ts` (L103-106)
  - Fix: Single partition loop: `const visible: ToolDef[] = []; const hidden: ToolDef[] = []; for (const t of tools) (ALWAYS_ON_TOOLS.has(t.name)||loaded.has(t.name) ? visible : hidden).push(t);` then early-return when hidden.length===0.
  - Test: Existing token-efficiency.test.ts applyLazyTools cases already assert the visible/hidden split; they pass unchanged after the refactor.
- **[u120-6 · perf/low/confirmed]** surfaceInputParamsSchema serializes the whole message via JSON.stringify on every input frame just to bound size
  - Files: `packages/runner/src/protocol.ts` (L591-599)
  - Fix: Bound the size more cheaply: cap individual string fields (e.g. a `data`/paste field) with z.string().max(...) within the passthrough shape, or only run the stringify-length guard when the message type is the bulk/paste kind. A per-keystroke control frame (single char) need not pay a full JSON.stringify.
  - Test: Benchmark relay of many small input frames before/after; assert oversized frames are still rejected and small frames pass without the stringify.

### [t2-json-store-block] Extract a generic createJsonFileStore block (mutex + atomic write + zod + quarantine)

- **Lens:** duplication | **Risk:** medium | **Effort:** L | **Findings merged:** 8
- **Packages:** packages/cli, packages/desktop-host, packages/plugin-provider-admin, packages/plugin-scheduler, packages/plugin-vault, packages/plugin-webhooks, packages/plugin-workflows, packages/sdk

**What / why:** VaultStore, WebhookStore, ScheduleStore, provider-admin store and workflows run-store each reimplement mutex + read+zod-validate + atomic write + quarantine. Add a registry/swappable createJsonFileStore<T> to @moxxy/sdk and migrate all five; this also fixes run-store NON-unique tmp collision and centralizes corrupt-file handling.

**Rationale / risk:** Invariant #5 open-coded N times; consolidation puts atomicity correctness in one tested place. SDK stays dep-free (uses its own fs-utils + mutex + caller schema). Medium risk: behavior-preserving migration of live stores, needs per-store test port + shared block tests.

**Affected files & merged findings:**

- **[duplication-2 · duplication/medium/unverified]** Whole-file JSON store pattern (mutex + read+zod-validate + atomic write + quarantine-on-corruption) reimplemented in 5 plugins
  - Files: `packages/plugin-vault/src/store.ts; packages/plugin-webhooks/src/store.ts; packages/plugin-scheduler/src/store.ts; packages/plugin-provider-admin/src/store.ts; packages/plugin-workflows/src/run-store.ts` (Lvault 62-273, webhooks 152-396, scheduler 87-225, provider-admin 40-72)
  - Fix: Add a generic `createJsonFileStore<T>({ path, schema, default, mode?, onCorrupt? })` block to @moxxy/sdk (it already owns writeFileAtomic + createMutex), returning `{ read(), update(fn) }` that does mutexed read-modify-write, zod validation, atomic write, and optional quarantine. Migrate the 5 stores onto it (registry/swappable-block friendly). SDK stays dep-free (uses only its own fs-utils + mutex + the caller-supplied zod schema).
  - Test: Port each store's existing tests onto the wrapper; add a shared block test for atomic-write durability, mutex serialization (concurrent update() calls), and corrupt-input quarantine.
- **[types-generics-1 · duplication/high/unverified]** 5 whole-file JSON CRUD stores re-implement the same cache+mutex+RMW pattern by hand
  - Files: `packages/plugin-scheduler/src/store.ts; packages/plugin-webhooks/src/store.ts; packages/plugin-provider-admin/src/store.ts; packages/plugin-vault/src/store.ts; packages/plugin-workflows/src/run-store.ts` (Lscheduler 87-227; webhooks 155-391)
  - Fix: Add a generic `JsonCollectionStore<T extends { id: string }>` in @moxxy/sdk (it already exports createMutex, writeFileAtomic, moxxyPath and has zero internal deps so the invariant holds). Constructor takes { file, schema: ZodType<{version:number; items:T[]}>, itemKey?='items' }. It owns cache/mutex/ensureLoaded/mutate/persist and exposes list/get/create(entry)/update(id,patch)/delete(id). Domain stores subclass it (or compose it) to add id/createdAt minting and bespoke methods (syncSkillSchedule, recordFire). Centralizes the atomicity invariant in ONE tested place.
  - Test: One vitest suite on the generic asserting: concurrent create/update don't clobber (mutex), crash mid-write leaves prior file intact (atomic), ENOENT/corrupt -> empty, mutator gets a fresh copy. Existing per-store tests then cover only domain logic.
- **[duplication-5 · atomicity/medium/unverified]** Three call sites reimplement tmp+rename instead of the canonical writeFileAtomic; run-store uses a NON-unique tmp (concurrent-writer collision)
  - Files: `packages/plugin-workflows/src/run-store.ts; packages/desktop-host/src/app-update/boot-log.ts; packages/cli/src/update/check.ts; packages/sdk/src/fs-utils.ts` (Lrun-store 48-50; boot-log 49-53; cli check 70-72)
  - Fix: run-store.ts: replace the manual tmp+writeFile+rename with `await writeFileAtomic(file, JSON.stringify(payload))` (also gives the mkdir). For the two sync sites add a `writeFileAtomicSync` to @moxxy/sdk/fs-utils (pid+uuid tmp + renameSync) and call it from boot-log.ts and cli/update/check.ts, retiring both inline copies.
  - Test: Unit test writeFileAtomicSync (target intact after a mid-write throw; tmp cleaned up). For run-store, a concurrency test issuing two save() calls and asserting both files land intact.
- **[helper-reuse-1 · atomicity/high/unverified]** WorkflowRunStore.save() hand-rolls tmp+rename instead of writeFileAtomic (sibling store.ts uses it)
  - Files: `packages/plugin-workflows/src/run-store.ts` (L43-52)
  - Fix: Import `writeFileAtomic` (already a @moxxy/sdk re-export, `moxxyPath` is already imported here) and replace the tmp+writeFile+rename block with `await writeFileAtomic(file, JSON.stringify(payload));`. Drop the `node:fs` tmp dance.
  - Test: Existing run-store save/load roundtrip test still passes; add an assertion that no `*.tmp` file remains after a save (proves rename completed) — writeFileAtomic guarantees cleanup on failure.
- **[persistence-consistency-5 · atomicity/low/unverified]** WorkflowRunStore.save hand-rolls a fixed-suffix .tmp instead of the shared atomic helper
  - Files: `packages/plugin-workflows/src/run-store.ts` (L43-52)
  - Fix: Replace the hand-rolled tmp+rename in save() with writeFileAtomic(file, JSON.stringify(payload)) from @moxxy/sdk.
  - Test: Unit: two concurrent save() calls don't collide on a temp path; a thrown write leaves no orphan .tmp.
- **[u103-6 · consistency/low/unverified-lowrisk]** Corrupt/invalid schedules file is silently reset to empty, dropping all schedules with no signal
  - Files: `packages/plugin-scheduler/src/store.ts` (L190-205)
  - Fix: On parse failure, preserve the bad file by renaming it to `schedules.json.corrupt-<ts>` before starting fresh, and surface a warn via an optional injected logger. At minimum, do not let the first mutate overwrite a file that failed to parse without backing it up.
  - Test: Write a malformed JSON file, call list(), assert []; then create() and assert the original bad file was backed up rather than clobbered.
- **[u93-4 · consistency/low/unverified-lowrisk]** configure() persists an unvalidated envVar shape; provider_add validates it but the on-disk schema does not
  - Files: `packages/plugin-provider-admin/src/index.ts; packages/plugin-provider-admin/src/store.ts` (L124-141)
  - Fix: Centralize the envVar regex (export it from key-name.ts) and validate patch.envVar in configure() before merging; optionally tighten storedProviderSchema.envVar to the same regex so a hand-edited providers.json with a bogus envVar is rejected on read.
  - Test: Test configure({ envVar: 'bad name' }) rejects; test provider_add already rejects (add if missing).
- **[u93-5 · review/low/unverified-lowrisk]** readProvidersConfig swallows ALL read errors (incl. EACCES/EIO) and silently returns empty
  - Files: `packages/plugin-provider-admin/src/store.ts` (L43-58)
  - Fix: Only treat err.code === 'ENOENT' (and JSON/schema failures) as empty; rethrow other fs errors so onInit's warn path actually reports them, or at minimum log a warning inside the catch when the error is not ENOENT.
  - Test: Test: chmod the file unreadable (or mock fs.readFile to reject EACCES) and assert readProvidersConfig surfaces/logs rather than silently returning empty; keep the existing ENOENT-and-malformed-return-empty tests green.

### [t2-writefileatomicsync] Add writeFileAtomicSync to the SDK and retire the three hand-rolled sync tmp+rename copies

- **Lens:** atomicity | **Risk:** low | **Effort:** M | **Findings merged:** 2
- **Packages:** packages/cli, packages/desktop-host

**What / why:** boot-log.ts, app-update/resolve.ts and cli/update/check.ts each hand-roll a sync tmp+rename (some with collision-prone pid-only tmp). Add writeFileAtomicSync (pid+uuid tmp + renameSync) to @moxxy/sdk/fs-utils and call it from all three.

**Rationale / risk:** Closes invariant-#5 gap for sync writers in boot/update paths. Low behavioral risk but new SDK surface, so test the mid-write-throw durability.

**Affected files & merged findings:**

- **[helper-reuse-3 · atomicity/medium/unverified]** Three near-identical SYNC tmp+rename atomic-write helpers — no writeFileAtomicSync in the SDK
  - Files: `packages/desktop-host/src/app-update/boot-log.ts; packages/desktop-host/src/app-update/resolve.ts; packages/cli/src/update/check.ts` (Lboot-log.ts:48-54; resolve.ts:128-134; check.ts:67-76)
  - Fix: Add `writeFileAtomicSync(target, data, opts?)` to packages/sdk/src/fs-utils.ts mirroring the async one (mkdirSync + unique-UUID tmp + writeFileSync + optional chmodSync + renameSync + rm-on-failure). Replace the three private helpers with imports. Note: cli is bundled — confirm tsup keeps the @moxxy/sdk import inlined (it already bundles sdk).
  - Test: Unit-test writeFileAtomicSync (mode honored past umask, no tmp residue on success, rollback on rename failure) alongside the existing async fs-utils.test.ts; migrate the three call-sites and run their suites.
- **[u29-2 · consistency/low/unverified]** writeCache hand-rolls tmp+rename instead of the shared atomic-write invariant; pid-only tmp can collide in-process
  - Files: `packages/cli/src/update/check.ts` (L67-76)
  - Fix: Replace the manual sync tmp+rename with `await writeFileAtomic(file, JSON.stringify(value, null, 2))` (writeCache's only caller, refreshCheck, is already async), or at minimum append a random suffix to the tmp name. Keep the try/catch best-effort swallow.
  - Test: Unit test: two concurrent refreshCheck() calls against the same cacheFile resolve without throwing and leave a valid (parseable) cache file.

### [t2-mutex-rmw-stores] Add the missing per-instance promise-mutex to read-modify-write whole-file stores (invariant #5)

- **Lens:** atomicity | **Risk:** medium | **Effort:** L | **Findings merged:** 18
- **Packages:** packages/cli, packages/config, packages/core, packages/desktop-host, packages/plugin-channel-web, packages/plugin-plugins-admin, packages/runner, packages/sdk

**What / why:** savePreferences (core), plugins-admin config.yaml mutators, desktop-host chat-log NDJSON appendEvents/clearLog, tunnel-settings, config_set, runner handleProviderSetEnabled, channel-auth token file, and skills audit-log removeAuditEntry all do un-mutexed RMW (last-writer-wins / index corruption / TOCTOU). Add the per-instance mutex (and atomic write where missing) following the usage-stats/mcp precedent.

**Rationale / risk:** Invariant #5 violations on live state files; concurrent fire-and-forget calls lose updates. Medium risk (touches widely-used persistence) and currently untested, so add concurrency tests with each.

**Affected files & merged findings:**

- **[persistence-consistency-2 · consistency/medium/unverified]** core preferences.json: savePreferences read-merge-write has no mutex (last-writer-wins clobber)
  - Files: `packages/core/src/preferences.ts` (L59-71)
  - Fix: Add a module-level `const writeMutex = createMutex()` (mirroring usage-stats.ts) and run the load->merge->write body of savePreferences inside `writeMutex.run(...)`.
  - Test: Promise.all two savePreferences({model:'a'}) and savePreferences({mode:'goal'}); assert the persisted file contains BOTH fields, not just the last writer's.
- **[test-coverage-2 · atomicity/high/unverified]** savePreferences read-modify-write has NO promise-mutex (invariant #5) and no test — concurrent fire-and-forget calls lose updates
  - Files: `packages/core/src/preferences.ts` (L59-71)
  - Fix: Wrap the RMW in a module-level promise-mutex (reuse @moxxy/sdk Mutex) so loadPreferences->merge->write runs serialized; then add packages/core/src/preferences.test.ts. Test cases: (a) round-trips a patch; (b) a second patch merges, does NOT clobber unrelated fields; (c) load tolerates missing/corrupt file -> {}; (d) mode migration via migrateModeName on load; (e) regression: Promise.all of two patches each setting a different field leaves BOTH fields present (proves the mutex serialized the RMW).
  - Test: Point HOME/preferencesPath at a tmpdir; exercise concurrent Promise.all to assert no lost update.
- **[persistence-consistency-3 · consistency/medium/unverified]** plugins-admin config.yaml mutators (setPluginEnabled/clearPluginState) have no mutex
  - Files: `packages/plugin-plugins-admin/src/config.ts` (L39-64)
  - Fix: Introduce a module-level write mutex and wrap the read-modify-write bodies of setPluginEnabled and clearPluginState (mirror mcp/config-io.ts mutateMcpConfig).
  - Test: Concurrently setPluginEnabled(A,false) and setPluginEnabled(B,false) against the same config path; assert both A and B end disabled in the persisted yaml.
- **[persistence-consistency-1 · consistency/medium/unverified]** chat-log NDJSON store has no mutex — concurrent chat.append/clearLog race the shared in-memory index
  - Files: `packages/desktop-host/src/chat-log.ts; packages/desktop-host/src/ipc/chat.ts` (L151-296)
  - Fix: Add a per-workspace (keyed by resolved file path) promise-mutex serializing appendEvents + clearLog + migrate for a given file, using createMutex from @moxxy/sdk. e.g. a Map<string, Mutex> keyed by fileFor(workspaceId), and run the read-stat-append-extend body and the clear body inside it.
  - Test: Fire two appendEvents(ws, batch) concurrently and an appendEvents racing clearLog; assert the NDJSON line count and loadSegment cursor offsets stay consistent (every offset points at a parseable line) and clearLog wins or loses cleanly without leaving stale dedup entries.
- **[complexity-hotspots-8 · atomicity/low/unverified]** appendEvents has no per-workspace write mutex; concurrent appends can corrupt the in-memory line index
  - Files: `packages/desktop-host/src/chat-log.ts` (L151-195)
  - Fix: Wrap appendEvents (and clearLog/migrate) in a per-workspace createMutex() like SessionPersistence.writeQueue does, so stat->append->index-extend is serialised per file. The size/mtime guard then only handles genuine out-of-band edits.
  - Test: Fire two appendEvents for the same workspace concurrently; assert the resulting file and rebuilt line index match a serial append, and loadSegment cursors stay correct.
- **[u56-1 · review/medium/confirmed]** appendEvents has no per-file mutex — concurrent chat.append races dedup + line index
  - Files: `packages/desktop-host/src/chat-log.ts; packages/desktop-host/src/ipc/chat.ts` (L151-195)
  - Fix: Add a per-file promise-mutex (createMutex from @moxxy/sdk, keyed by fileFor(workspaceId)) and run the whole knownIds→filter→append→index-extend sequence inside it, mirroring DeskStore.mutex. Idempotency-by-id then holds even for concurrent batches and the line index stays consistent.
  - Test: Vitest: point MOXXY_CHATS_DIR at a tmp dir, fire Promise.all of two appendEvents calls sharing one event id plus disjoint ids, then assert the file has exactly one copy of the shared id and that loadSegment offsets parse every line; repeat with the line-index pre-warmed (call loadSegment first) to exercise the extend path.
- **[persistence-consistency-7 · atomicity/low/unverified]** tunnel-settings writeTunnelSetting read-merge-write has no mutex (single-field clobber)
  - Files: `packages/plugin-channel-web/src/tunnel-settings.ts` (L43-46)
  - Fix: Wrap writeTunnelSetting's read-merge-write in a module-level createMutex().run(...).
  - Test: Concurrent writeTunnelSetting calls; assert the surviving file is well-formed and reflects one of the writes (and, once a second field exists, that the unrelated field is preserved).
- **[u73-1 · consistency/medium/unverified-lowrisk]** writeTunnelSetting does read-modify-write of web.json with no promise-mutex (invariant 5)
  - Files: `packages/plugin-channel-web/src/tunnel-settings.ts` (L43-46)
  - Fix: Add a module-level `const writeMutex = createMutex()` (from @moxxy/sdk) and wrap the read-modify-write body of writeTunnelSetting in `writeMutex.run(async () => { ... })`, mirroring provider-admin/store.ts.
  - Test: Unit test: fire two writeTunnelSetting calls concurrently (Promise.all with distinct names) against a temp file and assert the file ends in a valid, last-writer-wins state with no lost intermediate; without the mutex an interleaved read can clobber.
- **[persistence-consistency-6 · atomicity/low/unverified]** channel-auth token file write is non-atomic and unserialized
  - Files: `packages/sdk/src/channel-auth.ts` (L87-92)
  - Fix: Persist via writeFileAtomic (mode 0o600); optionally guard the generate-and-write with O_EXCL ('wx') so a concurrent first-run loses cleanly and re-reads the winner's token (mirrors chat-log.ts migrate and credential-lock acquireFileLock).
  - Test: Concurrently call resolveChannelToken twice on a fresh dir; assert both observers end up with the SAME persisted token.
- **[u122-5 · consistency/low/unverified-lowrisk]** Channel token file read/write is non-atomic and not mutex-guarded (invariant 5)
  - Files: `packages/sdk/src/channel-auth.ts` (L60-92)
  - Fix: Write via tmp file + fs.renameSync (rename is atomic on same fs) preserving mode 0o600; guard resolve/rotate with the SDK promise-mutex keyed by the absolute file path so concurrent resolves serialize. This is the same pattern every other whole-file store in the repo uses.
  - Test: Concurrency test: fire N parallel resolveChannelToken calls on a missing file; assert exactly one token is generated and all callers see the same value. Crash-injection test: assert a half-written tmp never clobbers the live file.
- **[persistence-consistency-8 · consistency/low/unverified]** skills audit-log removeAuditEntry rewrites the NDJSON non-atomically with no lock
  - Files: `packages/cli/src/commands/skills.ts` (L179-198)
  - Fix: Rewrite via writeFileAtomic; if concurrent append is reachable, serialize the audit log's append+rewrite behind a shared mutex (or read-then-rewrite under O_EXCL).
  - Test: Concurrently append an entry and removeAuditEntry(other-slug); assert the appended entry survives and the file stays valid NDJSON.
- **[u25-2 · consistency/medium/confirmed]** removeAuditEntry rewrites created.jsonl non-atomically (violates atomic tmp+rename invariant)
  - Files: `packages/cli/src/commands/skills.ts` (L179-198)
  - Fix: Use the shared atomic-write helper (writeFile to a sibling tmp then rename) for the rewrite; reuse @moxxy/sdk fs-utils rather than reinventing.
  - Test: Test that a simulated write failure (mock rename/writeFile to throw after tmp write) leaves the original created.jsonl intact; test round-trip remove keeps all non-matching slugs.
- **[u38-2 · consistency/medium/confirmed]** config_set read-modify-write lacks the per-instance promise-mutex required by invariant 5
  - Files: `packages/config/src/plugin.ts` (L153-194)
  - Fix: Wrap the read-modify-write body of config_set (and the write side of config_init) in a per-target promise-mutex (Map<path, Mutex> or a single plugin-scoped mutex), reusing the SDK mutex helper rather than reinventing.
  - Test: Fire two config_set handlers concurrently (Promise.all) setting two different dot-paths on the same fresh file; assert both keys survive in the final file.
- **[u120-2 · consistency/medium/confirmed]** handleProviderSetEnabled does an un-mutexed read-modify-write of preferences.json (TOCTOU)
  - Files: `packages/runner/src/server.ts` (L401-420)
  - Fix: Serialize all preferences writes behind a single promise-mutex (the SDK's promise-mutex helper) — ideally inside savePreferences in @moxxy/core so every caller is covered, with the merge happening inside the critical section. At minimum, serialize the runner's two prefs-writing handlers on one local mutex so they cannot interleave.
  - Test: Concurrently fire provider.setEnabled(A,false) and provider.setActive(B) and assert both effects persist in the final preferences.json across many iterations (race repro). Unit-test savePreferences under concurrent calls with distinct patches.
- **[u92-1 · review/medium/confirmed]** config.yaml read-modify-write has no per-instance mutex (invariant 5)
  - Files: `packages/plugin-plugins-admin/src/config.ts` (L39-64)
  - Fix: Add a module-level `const configMutex = createMutex()` (from @moxxy/sdk) and wrap the read+modify+write body of setPluginEnabled and clearPluginState in `configMutex.run(async () => { ... })`. Keep writeFileAtomic. This makes per-process RMW atomic; document that cross-process races (CLI vs running session) remain best-effort behind atomic rename.
  - Test: Unit test (new config.test.ts): point configPath at a tmp file, fire Promise.all of setPluginEnabled('a',false) and setPluginEnabled('b',false), then assert loadDisabledPackageNames() contains BOTH — fails today (one is lost), passes with the mutex.
- **[u92-3 · consistency/low/unverified-lowrisk]** writeUserConfig double-validates via safeParse but discards the (re-validated) parsed data quirk for undefined
  - Files: `packages/plugin-plugins-admin/src/config.ts` (L82-86)
  - Fix: Express deletion explicitly: build the next config object and conditionally delete the `plugins` key (`const next = {...config}; if (Object.keys(plugins).length>0) next.plugins = plugins; else delete next.plugins;`) rather than assigning undefined. Optionally drop the redundant second safeParse in writeUserConfig (input already validated on read) or keep it but comment why.
- **[persistence-consistency-4 · atomicity/low/unverified]** desktop skills writeSkill uses non-atomic writeFile (truncation risk on crash)
  - Files: `packages/desktop-host/src/skills.ts` (L53-57)
  - Fix: Replace the plain writeFile in writeSkill with writeFileAtomic from @moxxy/sdk (mkdir is handled inside the helper, so ensureDir() before it becomes redundant).
  - Test: Unit: monkeypatch writeFile to throw after partial write; assert the previous skill file content survives intact (no truncation).
- **[u58-4 · consistency/low/unverified-lowrisk]** deleteSkill uses a dynamic import for unlink while the module already statically imports node:fs/promises
  - Files: `packages/desktop-host/src/skills.ts` (L59-68)
  - Fix: Add `unlink` to the top-level static import and remove the inline dynamic import.
  - Test: Existing skills.test.ts round-trip; add a delete case to cover the path.

### [t2-active-def-registry] Extract generic ActiveDefRegistry / DefRegistry base for the 8 copy-paste registries

- **Lens:** duplication | **Risk:** low | **Effort:** L | **Findings merged:** 6
- **Packages:** packages/core

**What / why:** Five one-active-def registries (compactors/cache-strategies/tunnel-providers/view-renderers/workflow-executors) are byte-for-byte copies; three flat name->def registries (agents/channels/surfaces) duplicate register/unregister/list/get/has. Extract a generic base (string-keyed, runtime-populated per invariant #11) and add the missing getActiveName/has/clearActive + workflow-executor test.

**Rationale / risk:** Pure structural dedup that centralizes registry correctness; low risk but touches core registry plumbing so port the existing registry tests and add the missing one.

**Affected files & merged findings:**

- **[types-generics-2 · duplication/high/unverified]** 5 'one active def, no instance' registries are byte-for-byte copies; no shared base
  - Files: `packages/core/src/registries/compactors.ts; packages/core/src/registries/cache-strategies.ts; packages/core/src/registries/view-renderers.ts; packages/core/src/registries/tunnel-providers.ts; packages/core/src/registries/workflow-executors.ts` (Ln/a (whole files, 45-51 LOC each))
  - Fix: Extract `ActiveDefRegistry<TDef extends { name: string }>` into core/registries (or fold as a no-build variant of ActiveBackendRegistry). Constructor takes { noun, autoAdoptFirst?=true }. Each of the 5 becomes `class CompactorRegistry extends ActiveDefRegistry<CompactorDef> { constructor(){ super({noun:'Compactor'}) } }`. ModeRegistry (which adds change-listeners + legacy-name migration) and ProviderRegistry (disabled-set + instances) stay bespoke or extend with overrides.
  - Test: Single shared vitest for the base (dup-throw, auto-activate-first, unregister-clears-active, setActive-throws-unknown, getActive-null-when-empty). Keep the 5 existing per-registry tests as thin sanity checks.
- **[types-generics-4 · duplication/medium/unverified]** 3 'flat name->def, no active' registries duplicate register/unregister/list/get/has
  - Files: `packages/core/src/registries/agents.ts; packages/core/src/registries/channels.ts; packages/core/src/registries/surfaces.ts` (Lagents 11-45; channels 8-30; surfaces 10-31)
  - Fix: Extract `DefMapRegistry<TDef, K extends string = string>` parameterized by { noun, keyOf:(d)=>K } providing register/unregister/list/get/has. The three registries extend it; ChannelRegistryImpl adds listWithAvailability on top. Lower priority than #2 because these are smaller and one (surfaces) keys on `kind` not `name`.
  - Test: Shared base test (dup-throw, get/has/list, unregister). Per-registry tests keep only the extras (channel availability).
- **[u43-1 · atomicity/medium/unverified-lowrisk]** Three def-only registries are byte-identical copy-paste; extract a generic ActiveDefRegistry<TDef>
  - Files: `packages/core/src/registries/tunnel-providers.ts; packages/core/src/registries/view-renderers.ts; packages/core/src/registries/workflow-executors.ts` (L1-46)
  - Fix: Add a generic `ActiveDefRegistry<TDef extends { name: string }>` (def-only sibling of ActiveBackendRegistry) in registries/ providing register/replace/unregister/list/setActive/getActive(): TDef|null with the noun passed via constructor. Replace each of the three classes with `class ViewRendererRegistry extends ActiveDefRegistry<ViewRendererDef> { constructor(){ super('View renderer'); } }` etc. cache-strategies.ts/compactors.ts (outside this unit) can adopt it too. Preserve the exact `getActive() => null` and throw-message semantics so callers and existing tests pass unchanged.
  - Test: Keep the existing view-renderers/tunnel-providers tests and add the missing workflow-executors test (u43-2); they exercise register-dup-throws, auto-activate-first, unregister-clears-active, setActive-missing-throws against the shared base. Extend semantics.test.ts to include the new base once via a parameterized table.
- **[u43-3 · consistency/low/confirmed]** Def-only registries lack getActiveName/has/clearActive that the parallel ActiveBackendRegistry exposes
  - Files: `packages/core/src/registries/tunnel-providers.ts; packages/core/src/registries/view-renderers.ts; packages/core/src/registries/workflow-executors.ts` (L9-45)
  - Fix: Resolve via u43-1: a single ActiveDefRegistry base would give all three the same surface as ActiveBackendRegistry by construction. If u43-1 is deferred, leave as-is (no functional impact) rather than hand-adding methods to three files.
  - Test: Covered by u43-1's shared-base suite.
- **[u43-2 · test-gap/medium/unverified-lowrisk]** WorkflowExecutorRegistry has no unit test though all three sibling registries do
  - Files: `packages/core/src/registries/workflow-executors.ts` (L10-46)
  - Fix: Add packages/core/src/registries/workflow-executors.test.ts mirroring view-renderers.test.ts: register-throws-on-dup, getActive() returns first after register, getActive() returns null after unregistering the active one, setActive('missing') throws, replace() overwrites. If u43-1 lands, fold into the shared base's parameterized suite instead.
  - Test: vitest run packages/core; assert the five behaviors above.
- **[u42-7 · test-gap/low/unverified-lowrisk]** Alias lookup, byName index, availability fallback and cache-strategy active-slot have no unit tests
  - Files: `packages/core/src/registries/commands.ts; packages/core/src/registries/skills.ts; packages/core/src/registries/channels.ts; packages/core/src/registries/cache-strategies.ts`
  - Fix: Add focused unit tests for: command alias round-trip + collision; skill byName/filterByTriggers/replaceAll; channel availability error-to-{ok:false} mapping; cache-strategy auto-activate + unregister-clears. These tests double as the regression guards for u42-1/u42-2.
  - Test: See fix — the tests are the deliverable.

### [t2-openai-compat-factory] Extract defineOpenAICompatProvider and delete the per-vendor copy-paste

- **Lens:** duplication | **Risk:** low | **Effort:** M | **Findings merged:** 4
- **Packages:** packages/plugin-provider-admin, packages/plugin-provider-google, packages/plugin-provider-local, packages/plugin-provider-xai, packages/plugin-provider-zai

**What / why:** zai/xai/google/local each hand-roll the same createClient (config-forcing new OpenAIProvider) + validateOpenAICompatKey; provider-admin/factory.ts already generalizes it. Add defineOpenAICompatProvider to plugin-provider-openai and delegate all five (incl. provider-admin) to one path.

**Rationale / risk:** Invariant-safe (vendors already depend on plugin-provider-openai). Low risk; per-vendor test asserting ProviderDef.name == vendor slug, not openai.

**Affected files & merged findings:**

- **[duplication-1 · duplication/medium/unverified]** OpenAI-compatible provider shim (createClient + validateKey) copy-pasted across 4 built-in vendor plugins + provider-admin
  - Files: `packages/plugin-provider-zai/src/index.ts; packages/plugin-provider-xai/src/index.ts; packages/plugin-provider-google/src/index.ts; packages/plugin-provider-local/src/index.ts; packages/plugin-provider-admin/src/factory.ts` (Lzai 27-45, xai 23-39, google 22-43, local createClient; admin factory 18-37)
  - Fix: Add a `defineOpenAICompatProvider({ name, baseURL, defaultModel, models, auth, validate? })` factory to @moxxy/plugin-provider-openai (the package that owns OpenAIProvider + validateOpenAICompatKey — invariant-safe: vendor plugins already depend on it). Replace each vendor's createClient/validateKey boilerplate with one call, and refactor provider-admin/factory.ts:buildProviderDef to delegate to the same factory so there is one OpenAI-compat construction path. z.ai's Anthropic-compat 'plan' provider stays bespoke (different base class).
  - Test: Per-vendor unit test asserting the built ProviderDef.name equals the vendor slug (not 'openai'), baseURL/defaultModel default correctly, and validateKey probes the vendor baseURL; reuse provider-admin/factory existing tests for the shared factory.
- **[types-generics-3 · duplication/medium/unverified]** Built-in OpenAI-compatible providers hand-copy the createClient cfg-forcing block factory.ts already generalizes
  - Files: `packages/plugin-provider-xai/src/index.ts; packages/plugin-provider-zai/src/index.ts; packages/plugin-provider-local/src/index.ts; packages/plugin-provider-admin/src/factory.ts` (Lxai 25-44; zai 30-50; local 60-80; factory 18-37)
  - Fix: Export a `defineOpenAICompatProvider({ name, baseURL, defaultModel, models, auth, validate?=true, apiKeyFallback? })` helper from @moxxy/plugin-provider-openai. xai/zai/local then each become a single declarative call; factory.ts:buildProviderDef delegates to it too, so runtime-added and built-in vendors share one codepath (and one `config as OpenAIProviderConfig` cast site instead of three).
  - Test: Unit-test the helper once (name override applied, baseURL/defaultModel defaulting, validateKey wired). Existing xai/zai/local index tests assert only the vendor constants.
- **[u96-2 · consistency/low/unverified]** OpenAI-compat provider wrapper is copy-pasted verbatim across google/xai/zai — extract a shared factory
  - Files: `packages/plugin-provider-google/src/index.ts; packages/plugin-provider-xai/src/index.ts; packages/plugin-provider-zai/src/index.ts` (L21-39)
  - Fix: Add a `defineOpenAICompatProvider({ name, baseURL, defaultModel, models, hint })` helper (export from @moxxy/plugin-provider-openai, which all three already depend on) that returns the defineProvider spec; have google/xai/zai each call it with their constants. Removes ~18 duplicated lines per package and centralizes the cast + base-URL fallback logic.
  - Test: Existing per-plugin index.test.ts (name stamping, catalog forced, apiKey auth) continues to pass unchanged after refactor; add one helper test asserting baseURL/defaultModel fallback semantics.
- **[u102-2 · atomicity/low/confirmed]** OpenAI-compat provider def is copy-paste of xai/google/openai (should be a shared factory)
  - Files: `packages/plugin-provider-zai/src/index.ts` (L24-42)
  - Fix: Extract a `defineOpenAICompatProvider({ name, baseURL, defaultModel, models, hint })` helper (and an Anthropic-compat sibling for the coding-plan path) in @moxxy/plugin-provider-openai / -anthropic (or a shared provider-utils), and have zai/xai/google call it. Keeps the per-vendor file to a few constants.
  - Test: Reuse existing index.test.ts assertions (provider names, model catalog, vendor-slug stamping) against the factory output; add a parametrized test over all vendors.

### [t2-oneshot-stream-helper] Add a shared one-shot provider-stream collector and retire the 5 hand-rolled copies

- **Lens:** duplication | **Risk:** medium | **Effort:** M | **Findings merged:** 4
- **Packages:** packages/compactor-summarize, packages/core, packages/plugin-memory, packages/plugin-workflows

**What / why:** router.ts / synthesize-draft.ts / consolidate.ts / compactor index.ts / memory draft.ts each inline a for-await text_delta collector (the SDK has collectProviderStream). Several copies also drop graceful-abort partials or stringify-throw guarding. Centralize one helper.

**Rationale / risk:** Consistency + several latent bugs (partial text returned as complete summary, throwing tool input aborting compaction). Medium risk: changes summary/compaction output paths, needs equivalence tests.

**Affected files & merged findings:**

- **[helper-reuse-2 · duplication/medium/unverified]** Five copies of the bare-provider 'for await text_delta' collector — no shared one-shot stream helper
  - Files: `packages/core/src/skills/router.ts; packages/core/src/skills/synthesize-draft.ts; packages/plugin-memory/src/consolidate.ts; packages/compactor-summarize/src/index.ts; packages/plugin-workflows/src/draft.ts` (Lrouter.ts:57-69; synthesize-draft.ts:24-36; consolidate.ts:162-175; index.ts:133-148; draft.ts:232-249)
  - Fix: Add a small `collectText(provider, req): Promise<{text, stopReason, error}>` helper to packages/sdk/src/provider-utils.ts (bare LLMProvider, no ModeContext) that runs the for-await loop once with consistent error semantics, then import it in all five sites. Standardize error handling (return a typed error rather than divergent throw/swallow). This fixes router.ts's silent error-swallow as a side effect.
  - Test: Unit-test collectText against a fake provider emitting text_delta + error + message_end; migrate each site and re-run their existing suites (skill router, memory consolidate, compactor, workflow_create draft).
- **[u37-1 · consistency/medium/unverified]** contextChars/safeJsonLen reimplement SDK's private eventChars and already diverge on attachments
  - Files: `packages/compactor-summarize/src/index.ts` (L173-198)
  - Fix: Export a per-event context-cost helper from @moxxy/sdk (e.g. `eventContextChars(e)`), or expose it via estimateContextTokens' internals, and have contextChars call it so the compactor's savings accounting cannot drift from what projectMessagesFromLog actually sends. At minimum, mirror the attachment-counting branch.
  - Test: Add a test compacting a user_prompt with a file attachment and assert tokensSaved reflects text+attachment chars; add a shared snapshot test that contextChars and the SDK eventChars agree for each event type.
- **[u37-2 · review/low/unverified]** describeEvent uses raw JSON.stringify on unknown tool input; one throwing input aborts the whole compaction
  - Files: `packages/compactor-summarize/src/index.ts` (L162-163)
  - Fix: Replace the inline JSON.stringify in describeEvent with safeJsonLen-style guarded stringify (reuse the existing safeJsonLen or a tryStringify helper) so a malformed tool input degrades that one digest line instead of killing the whole compaction.
  - Test: Unit test compact() with a tool_call_requested whose input contains a circular reference; assert a valid CompactionEvent is still produced and the offending line is rendered safely.
- **[u37-3 · review/low/unverified]** providerSummary returns partial streamed text as a complete summary on graceful abort
  - Files: `packages/compactor-summarize/src/index.ts` (L132-153)
  - Fix: After the loop, if ctx.signal?.aborted return null (so callers fall back to the labeled digest), and/or only accept the summary when a message_end with a non-aborted stopReason was observed.
  - Test: Unit test with a fake provider that yields one delta then ends after the AbortController is aborted; assert providerSummary returns null and compact() uses fallbackDigest.

### [t2-frontmatter-parser-dup] Move the copy-pasted frontmatter/markdown mini-parsers into a shared home + test them

- **Lens:** consistency | **Risk:** low | **Effort:** M | **Findings merged:** 6
- **Packages:** packages/chat-model, packages/core

**What / why:** core skills/parse.ts frontmatter parser is copied verbatim in plugin-memory; the chat-model hand-rolled markdown block+inline parser (rendered on every surface) has zero tests and minor bugs (ordered-list start discarded, escaped pipes in table cells, stripInline/tokenizeInline drift).

**Rationale / risk:** Parser logic that renders assistant output everywhere; consolidate + add the missing tests, fixing the small correctness bugs in the same PR. Low-medium risk.

**Affected files & merged findings:**

- **[u46-3 · consistency/medium/confirmed]** Frontmatter mini-parser is copy-pasted (plugin-memory mirrors it verbatim); belongs in zero-dep @moxxy/sdk
  - Files: `packages/core/src/skills/parse.ts` (L1-98)
  - Fix: Move the parser into @moxxy/sdk (zero internal deps — invariant #1, e.g. a new subpath alongside fs-utils) and have core/skills/parse.ts and plugin-memory/parse.ts both re-export from it. Eliminates the divergence and the maintenance hazard.
  - Test: Promote the existing parse.test.ts cases to the shared SDK module; ensure both core and plugin-memory import it and their existing tests pass unchanged.
- **[u21-1 · test-gap/medium/confirmed]** Entire hand-rolled markdown parser (block + inline) has zero unit tests
  - Files: `packages/chat-model/src/markdown/parse-blocks.ts; packages/chat-model/src/markdown/inline.ts` (Lparse-blocks.ts:1-164, inline.ts:9-46)
  - Fix: Add packages/chat-model/src/markdown/parse-blocks.test.ts and inline.test.ts covering: fenced code (open + unclosed), GFM table with/without separator, inline-glued single-line table normalization, header/separator/row column-count mismatch, ordered vs bullet list runs, heading levels 1-6 + clamping, paragraph join across lines, blank lines; and for inline: code/bold/italic/link precedence, stripInline vs tokenizeInline visible-char parity, asterisk/backtick edge cases.
  - Test: Snapshot the Block[] / InlineTok[] outputs for a fixture corpus of model-emitted markdown; assert stripInline(x).length parity with the rendered glyph count for table-width cases.
- **[u21-2 · review/low/unverified-lowrisk]** Ordered-list start number is discarded — list renumbers from 1
  - Files: `packages/chat-model/src/markdown/parse-blocks.ts` (L58-72)
  - Fix: Capture the first item's numeric value and add an optional `start?: number` to the list Block (types.ts), defaulting to 1; renderer uses `start + i`.
  - Test: Parse `3. a\n4. b` and assert start === 3; renderer test asserts first bullet renders `3.`.
- **[u21-3 · consistency/low/unverified-lowrisk]** stripInline / tokenizeInline 'mirror exactly' claim is only approximately true
  - Files: `packages/chat-model/src/markdown/inline.ts` (L35-46)
  - Fix: Either (a) derive stripInline by running tokenizeInline and concatenating the rendered text of each token (single source of truth, guaranteed parity), or (b) soften the docstring to 'approximately mirrors, sufficient for width estimation'. Option (a) erases the duplication.
  - Test: Property test: for random markdown strings, assert stripInline(s) === tokenizeInline(s).map(renderedText).join('') under the chosen invariant.
- **[u21-4 · completion/low/unverified-lowrisk]** Table cell parser does not honor escaped pipes (\|) — splits cell content
  - Files: `packages/chat-model/src/markdown/parse-blocks.ts` (L147-151)
  - Fix: Split on an unescaped-pipe regex (e.g. /(?<!\\)\|/) then unescape `\|`->`|` per cell, mirroring GFM. Keep it small and shared with the separator/align splitters.
  - Test: Parse `| a \| b | c |` with a matching separator and assert the row yields two cells [`a | b`, `c`].
- **[test-coverage-8 · test-gap/low/unverified]** chat-model markdown block/inline parser untested (renders assistant output on every surface)
  - Files: `packages/chat-model/src/markdown/parse-blocks.ts; packages/chat-model/src/markdown/inline.ts`
  - Fix: Add packages/chat-model/src/markdown/parse-blocks.test.ts with table-driven cases: paragraphs, headings, fenced + unterminated code blocks, lists, blockquotes, and inline.test.ts for bold/italic/code/link/escape edge cases. Pure-function snapshot/assert.
  - Test: Table-driven pure-function tests; no I/O.

### [t2-sdk-server-subpath] Split Node builtins out of the @moxxy/sdk main barrel into a ./server subpath + widen dep-cruiser

- **Lens:** review | **Risk:** low | **Effort:** M | **Findings merged:** 2
- **Packages:** .dependency-cruiser.cjs, package.json, packages/sdk

**What / why:** The SDK main barrel statically re-exports node:child_process/fs/crypto/http, held safe today only by import-type discipline; dep-cruiser does not even cruise the desktop renderer or mobile-poc. Move Node-only exports to @moxxy/sdk/server and widen the dep-cruiser scope to catch RN/browser boundary breaches.

**Rationale / risk:** Protects the browser/RN boundary (invariant-adjacent). Medium care: must not break existing deep imports; coordinate with consumers. Adds CI coverage.

**Affected files & merged findings:**

- **[boundaries-1 · review/medium/unverified]** @moxxy/sdk main barrel statically re-exports node:child_process/fs/crypto/http into the browser/RN surface
  - Files: `packages/sdk/src/index.ts; packages/sdk/src/tunnel.ts; packages/sdk/src/fs-utils.ts; packages/sdk/src/channel-auth.ts; packages/sdk/src/http-utils.ts` (Lindex.ts:184-198)
  - Fix: Move the Node-runtime helpers behind an explicit server-only subpath (e.g. add './server' to exports mapping fs-utils/tunnel/http-utils/channel-auth) and drop their re-exports from the main barrel, OR at minimum add a forbidden dep-cruiser rule asserting `packages/sdk/src/index.ts` (and any module reachable from a browser-consumed export) must not transitively reach `node:*`. Update node-side consumers (cli/runner/channel plugins) to import from '@moxxy/sdk/server'. Keep the pure type/logic exports (events, tool-display, mode-helpers, compactor-helpers — all already node-free) on the main barrel.
  - Test: Add a vitest/CI check that resolves the './tool-display' and main-barrel type graph and asserts no `node:` specifier is reachable from browser-consumed exports; or a dep-cruiser rule from packages consumed by client-core/chat-model/mobile-poc to node:*. Build apps/mobile-poc with Metro to confirm.
- **[boundaries-2 · test-gap/medium/unverified]** dep-cruiser scope excludes apps/desktop renderer and apps/mobile-poc — RN/browser boundary breaches would go undetected
  - Files: `.dependency-cruiser.cjs; package.json` (L.dependency-cruiser.cjs:81)
  - Fix: Extend includeOnly (and the depcruise CLI args) to cover `apps/desktop/src`, `apps/mobile-poc/src`, and add a forbidden rule: from `apps/(desktop/src|mobile-poc)` to `node:*` severity error (renderer/RN must not statically reach Node builtins). Optionally a rule forbidding apps/desktop/src -> apps/desktop/electron static imports (renderer must not import main-process code).
  - Test: Run `pnpm check:deps` after widening scope; confirm it still passes clean on current main, then add a temporary node:fs import to a renderer file to confirm the new rule fires.

### [t2-external-store-dup] Consolidate the hand-rolled external stores and optimistic connection-flip in client-core

- **Lens:** duplication | **Risk:** medium | **Effort:** L | **Findings merged:** 4
- **Packages:** packages/client-core

**What / why:** useDesks/useSessions/useConnection each hand-roll subscribe/emit/listeners; the optimistic connection-flip on session switch is duplicated across desksStore.setActiveSession and sessionsStore; queue ids (q-<rev>-<len>) can collide after dropFromQueue. Fold sessionsStore into thin selectors over desksStore (per TECH_DEBT L878) and unify the store primitive.

**Rationale / risk:** State-store refactor (not a pure extraction) feeding desktop + mobile; medium risk. The chatStore has NO co-located test today, so build the test harness first (see t2-test-harness).

**Affected files & merged findings:**

- **[duplication-6 · duplication/low/unverified]** Optimistic connection-flip logic duplicated across desksStore.setActiveSession and sessionsStore (useSessions) paths
  - Files: `packages/client-core/src/useDesks.ts; packages/client-core/src/useSessions.ts` (LuseDesks setActiveSession 170+; useSessions parallel path)
  - Fix: Fold the tracked-desk sessionsStore into thin selectors over desksStore (as the TECH_DEBT entry proposes) so the connection-flip lives in exactly one place; do it when either file is next touched. Lower priority — it is a state-store refactor, not a pure extraction.
  - Test: Existing client-core store tests for both hooks must pass against the consolidated path; add a switch-session test asserting the optimistic active id updates before the RPC resolves.
- **[u33-5 · consistency/low/unverified-lowrisk]** Three near-identical hand-rolled external stores (subscribe/emit/listeners Set) duplicated
  - Files: `packages/client-core/src/useDesks.ts; packages/client-core/src/useSessions.ts; packages/client-core/src/useConnection.ts` (LuseDesks 52-92; useSessions 56-100; useConnection 12-55)
  - Fix: Extract a tiny generic `createExternalStore<T>()` (state + subscribe + getSnapshot + set) and a shared `optimisticSwitch` helper that captures/restores both the store's active id and connectionStore.active$(); have all three stores build on it. Erases the duplication and centralizes the rollback contract.
  - Test: Unit-test the extracted helper once; the existing useSessions tests plus new useDesks tests cover the call sites.
- **[u31-1 · review/medium/confirmed]** Queue ids are not unique: `q-<rev>-<len>` can collide after dropFromQueue, dropping wrong items
  - Files: `packages/client-core/src/chat-store/store.ts` (L126-155)
  - Fix: Use a monotonic per-store counter (e.g. `private queueSeq = 0` -> `q-${this.queueSeq++}`) or crypto.randomUUID/newBlockId() for the queued-turn id; never derive identity from mutable length or shared rev.
  - Test: Unit test: enqueue two turns at a fixed rev, dropFromQueue the first, enqueue a third, assert all three ids are distinct and dropFromQueue removes exactly one entry.
- **[u31-5 · review/low/unverified-lowrisk]** hiddenTurns can leak an id if a hidden turn errors without a turn_complete for that turnId
  - Files: `packages/client-core/src/chat-store/store.ts` (L42-93)
  - Fix: Have callers always pair hideTurn/unhideTurn in a finally (the AI-skill-draft caller), or also clear the hidden id on the matching send_failed/abort/error event for that turnId; consider scoping hiddenTurns per workspace and clearing it in drop().
  - Test: Unit test: hideTurn(t); dispatch a turn that errors without turn_complete(t); assert (after fix) the id is gone and later events are not dropped.

### [t2-security-correctness] Fix confirmed security/boundary correctness bugs (each needs a regression test)

- **Lens:** review | **Risk:** medium | **Effort:** M | **Findings merged:** 11
- **Packages:** packages/core, packages/desktop-host, packages/desktop-ipc-contract, packages/isolator-subprocess, packages/isolator-worker, packages/plugin-channel-web, packages/plugin-provider-admin, packages/plugin-security

**What / why:** isSafeViewUrl whitespace bypass (java\tscript: XSS); brokerFetch follows redirects bypassing the net allowlist (SSRF); permission-engine invalid-regex deny rule fails open; desktop-ipc remote commands accept unbounded strings (no schema); surface.* forwards unvalidated PTY text to runner; desktop skills assertSafeName misses backslash; provider_add can overwrite a built-in provider; isolator SIGTERM-only kill with no SIGKILL escalation; worker security doc contradicts behavior.

**Rationale / risk:** These are real confirmed security/boundary defects surfaced by the quality sweep. Each is a tight fix but security-load-bearing, so every one ships with a regression test. Medium risk by virtue of the trust boundary.

**Affected files & merged findings:**

- **[u72-1 · review/high/confirmed]** isSafeViewUrl whitespace bypass: 'java\tscript:' passes the gate then executes as XSS
  - Files: `packages/plugin-channel-web/src/frontend/url-safety.ts; packages/plugin-channel-web/src/frontend/render.tsx` (L17-23)
  - Fix: Before the checks, strip ALL ASCII whitespace and control chars the URL parser would ignore: const u = url.replace(/[\u0000-\u0020]/g, '').toLowerCase(); (or replace(/\s/g,'') plus \x00-\x1f). Then run the existing prefix/regex checks against the collapsed string. Keep the canonical SDK copy (packages/sdk/src/view-renderer.ts isSafeViewUrl) in lockstep — same edit. Note: the original raw value should still be what is rendered/blocked, but the SAFETY DECISION must be made on the whitespace-collapsed form.
  - Test: Add a render.test.ts case: link with href 'java\tscript:alert(1)', 'java\nscript:alert(1)', 'jav ascript:alert(1)', and '\x00javascript:alert(1)' must each render as plain text (no href=, no 'script'). Add a direct url-safety unit test table asserting isSafeViewUrl returns false for each whitespace/control-split scheme.
- **[u105-1 · review/high/confirmed]** brokerFetch follows redirects, bypassing the net allowlist (SSRF)
  - Files: `packages/plugin-security/src/broker.ts` (L252-287)
  - Fix: Use redirect:'manual' and re-run urlInScope on every Location hop in a bounded loop (cap hops, deny on out-of-scope or private-IP target), or at minimum set redirect:'error' so any redirect from an allowlisted host fails closed. Reuse the ssrf-guard logic already present in @moxxy/plugin-browser/src/ssrf-guard.ts rather than reinventing host filtering.
  - Test: Spin a local http server that 302s to http://127.0.0.1:<other>/ ; assert brokerFetch with net.mode='allowlist' hosts=[that server] denies/errs rather than fetching the redirect target.
- **[u40-1 · review/high/confirmed]** Invalid-regex fallback makes deny rules fail open (security gate weakens silently)
  - Files: `packages/core/src/permissions/engine.ts` (L143-150)
  - Fix: Pre-compile and validate inputMatches regexes at rule-add time (sanitizeRule) / load time and reject (or normalize) invalid patterns, so matchRule never has to guess at runtime. If runtime fallback must remain, make deny-rule evaluation fail closed: pass the rule's list intent into matchRule and, for deny rules, treat an uncompilable pattern as a match (or escape v and recompile as a literal regex) rather than requiring exact string equality.
  - Test: Add a test: deny rule with an invalid-regex inputMatches value must still deny a call whose input contains that substring; assert check() returns mode:'deny'. Add an allow-rule counterpart asserting it does NOT over-allow.
- **[u59-2 · completion/medium/confirmed]** Remote-reachable commands session.abortTurn / session.info / sessions.list accept unbounded strings (no schema)
  - Files: `packages/desktop-ipc-contract/src/validation.ts; packages/desktop-ipc-contract/src/index.ts` (L75-267)
  - Fix: Add bounded schemas for the remote-reachable, arg-carrying commands: `session.abortTurn` -> z.object({ workspaceId: optionalWorkspace, turnId: z.string().min(1).max(256) }); `session.info` -> z.object({ workspaceId: optionalWorkspace }).optional(); `sessions.list` -> z.object({ deskId: z.string().min(1).max(256).optional() }).optional(). Consider a CI/test assertion that every IpcCommandName in REMOTE_ALLOWED_COMMANDS taking a non-undefined arg has a schema entry.
  - Test: Unit test: for each command in REMOTE_ALLOWED_COMMANDS whose IpcCommands signature has a parameter, assert ipcInputSchemas[cmd] is defined; plus a validation.test case rejecting an oversize turnId/deskId.
- **[u55-2 · consistency/low/unverified-lowrisk]** surface.* commands forward unvalidated input (incl. PTY text) to the runner with no boundary schema
  - Files: `packages/desktop-host/src/ipc/surfaces.ts` (L23-41)
  - Fix: Add bounded schemas: surface.open `{workspaceId, kind: z.string().max(64)}`, surface.input `{workspaceId, surfaceId: z.string().max(128), message: z.string().max(100_000)}`, surface.resize `{workspaceId, surfaceId, size: z.object({cols, rows}).optional()}`, surface.close `{workspaceId, surfaceId}` to validation.ts.
  - Test: Add validateIpcInput unit cases per surface command rejecting oversized/malformed payloads; assert valid payloads pass.
- **[u58-3 · review/low/unverified-lowrisk]** assertSafeName misses backslash separator — subdir/abs path can slip through on Windows
  - Files: `packages/desktop-host/src/skills.ts` (L70-74)
  - Fix: Add `|| name.includes('\\')` to the rejection condition (and consider rejecting any name where path.basename(name) !== name as a single robust check).
  - Test: Add a skills.test.ts case asserting writeSkill('sub\\evil.md', 'x') rejects with /invalid/.
- **[u93-3 · review/medium/confirmed]** provider_add / onInit can silently overwrite a built-in provider (openai/anthropic) via replace()
  - Files: `packages/plugin-provider-admin/src/index.ts` (L204-207)
  - Fix: Reject (or refuse to replace) reserved/built-in provider names. Cheapest: only register/replace when the existing def is itself a stored one — track stored names, and for built-in collisions throw a CONFIG_INVALID ('cannot shadow built-in provider X; pick another slug'). At minimum, never replace() a def the plugin did not itself register.
  - Test: Test: pre-register an 'openai' def in FakeRegistry (simulating the built-in), call provider_add(name:'openai',...) and assert it throws / leaves the built-in def untouched; assert onInit does not clobber a built-in when providers.json contains a colliding entry.
- **[u62-1 · review/medium/confirmed]** Timeout/abort kills child with SIGTERM only — no SIGKILL escalation; runaway handler survives
  - Files: `packages/isolator-subprocess/src/index.ts` (L219-243)
  - Fix: In `finish`, after `child.kill('SIGTERM')`, schedule an escalation timer (e.g. `const k = setTimeout(() => { if (!child.killed) child.kill('SIGKILL'); }, 2000); k.unref?.()`). Optionally clear it on the `exit` event. Add a regression test using a handler that ignores SIGTERM (process.on('SIGTERM', ()=>{}) + busy loop) and assert the process is gone shortly after timeout.
  - Test: Fixture handler installs a SIGTERM trap then spins; after timeMs the isolator rejects AND the child PID is no longer alive (poll process.kill(pid,0)). Requires exposing/observing the pid in a test build or asserting via OS.
- **[u64-1 · consistency/medium/confirmed]** Security doc-block contradicts shipped behavior: claims node:fs unblocked & only readFile brokered
  - Files: `packages/isolator-worker/src/index.ts` (L159-176)
  - Fix: Rewrite the 'still does NOT enforce' block to match reality: the loader hook now blocks direct node:fs/child_process/net/http/tls (BLOCKED_HANDLER_MODULES) and all of readFile/writeFile/readdir/stat/fetch/exec are brokered. Keep only the genuinely-open gaps (env inheritance via process.env passthrough in the shim, no VM/heap-isolation beyond V8 limits, loader covers ESM-resolve only — not eval/createRequire escapes).
  - Test: Doc-only; the existing broker-e2e loader-hook describe block already pins the real behavior. Add an assertion comment cross-referencing the doc so drift is caught in review.
- **[u64-2 · completion/medium/unverified-lowrisk]** Synthetic ctx.signal is a fresh never-aborted AbortController — cooperative cancel inside the handler is dead
  - Files: `packages/isolator-worker/src/index.ts` (L98)
  - Fix: Propagate abort into the worker: on parent abort/timeout, postMessage({type:'abort'}) before terminate (with a short grace period), and in the shim hold a module-level AbortController whose signal is passed to ctx; the message handler calls controller.abort(). Alternatively, document on the synthetic ctx that signal is inert under the worker isolator so handlers don't rely on it. Mirror whatever isolator-subprocess does for consistency.
  - Test: Add a fixture handler that resolves only when ctx.signal fires (e.g. await once(ctx.signal,'abort')); assert that an external ctrl.abort() resolves it via a clean message path (distinct from the hard-terminate timeout test already present).
- **[u62-3 · review/low/unverified-lowrisk]** spawn() omits cwd — child process.cwd() is parent's dir, not call.cwd
  - Files: `packages/isolator-subprocess/src/index.ts` (L209-212)
  - Fix: Add `cwd: call.cwd` to the spawn options (line 209-212). Verify call.cwd is always defined for this isolator (it is required on IsolatedToolCall).
  - Test: Fixture handler returns process.cwd(); assert it equals the call.cwd passed in (e.g. a tmp dir distinct from the test runner's cwd).

### [t2-oauth-token-races] Fix OAuth/provider token refresh races and stale-field bugs

- **Lens:** review | **Risk:** medium | **Effort:** M | **Findings merged:** 4
- **Packages:** packages/plugin-oauth, packages/plugin-provider-anthropic, packages/plugin-provider-openai-codex

**What / why:** oauth_get_token refreshes without the per-credential lock (re-races rotating tokens); storeTokenSet leaves stale id_token/expires_at/scope after a partial refresh; anthropic provider OAuth refresh+401-replay has zero tests; codex encrypted-reasoning round-trip is emitted/stored but never replayed.

**Rationale / risk:** Token-rotation correctness with no current coverage; medium risk (auth path). Add the per-credential lock + refresh-replay tests.

**Affected files & merged findings:**

- **[u91-1 · review/high/confirmed]** oauth_get_token refreshes without the per-credential lock — re-races rotating tokens
  - Files: `packages/plugin-oauth/src/tools.ts` (L237-261)
  - Fix: Route the tool's refresh+store through withCredentialLock(`oauth-${provider}`, ...) re-reading creds inside the lock (or better, delegate to a shared refreshAndStore used by both ensure-fresh and tools to erase the duplication). Add the isAuthRejection re-read-once recovery too.
  - Test: Concurrency test: fire two oauth_get_token handlers at an expired credential against a fake token endpoint that returns a NEW refresh_token each call and rejects (invalid_grant) on a stale one; assert exactly one network refresh and no AUTH error.
- **[u91-2 · review/high/confirmed]** storeTokenSet leaves stale id_token / expires_at / scope after a refresh that omits them
  - Files: `packages/plugin-oauth/src/storage.ts` (L61-92)
  - Fix: On store, for each optional key delete the vault key when the new value is undefined (vault.delete?.(`${base}/expires_at`) etc.), so the stored set exactly mirrors the live TokenSet. Alternatively write the whole credential as one JSON blob under a single key to get atomic replace semantics.
  - Test: Unit: store a tokenSet with expiresAt+idToken+scope, then store a refreshed tokenSet missing all three; readStoredCreds must return a tokenSet WITHOUT those fields.
- **[u94-1 · test-gap/high/confirmed]** OAuth token refresh + 401 refresh-and-replay path has zero unit coverage
  - Files: `packages/plugin-provider-anthropic/src/provider.ts` (L142-156, 262-278)
  - Fix: Add tests: (1) oauthExpiresAt within 60s skew -> ensureFreshOauth calls refresh and makeOauthClient gets the new token; (2) streamOnce throws an error with status:401 -> stream() calls refreshOauthNow once and replays, emitting exactly one message_start and one message_end; (3) second 401 on replay -> single error event; (4) refresh callback that throws -> error event, no replay.
  - Test: Fake client whose stream() throws {status:401} on first call and yields DONE_EVENTS on second; assert refresh invoked once and message_start count === 1.
- **[u99-1 · completion/medium/confirmed]** Encrypted reasoning round-trip is half-built: emitted/stored but never replayed into input
  - Files: `packages/plugin-provider-openai-codex/src/translate.ts` (L92-136)
  - Fix: In `toResponsesInput`, for assistant messages emit a Responses `reasoning` input item (`{type:'reasoning', encrypted_content: block.encrypted}`, or the documented `{type:'reasoning', summary:[], encrypted_content}` shape) for each `reasoning` block that carries `encrypted`, positioned before the function_call items, matching codex-rs replay. Add the `reasoning` variant to the `ResponsesInputItem` union and skip unsigned/unencrypted reasoning.
  - Test: Unit test: build a ProviderRequest whose assistant message contains a `{type:'reasoning', encrypted:'BLOB'}` block followed by a tool_use, assert `toResponsesInput` output contains a reasoning input item carrying BLOB ahead of the function_call. Round-trip test: feed an SSE stream that emits reasoning_signature, capture the stored block, replay it, assert it survives.

### [t2-embedding-correctness] Harden embedder/memory correctness and recall hot-path I/O

- **Lens:** review | **Risk:** medium | **Effort:** M | **Findings merged:** 8
- **Packages:** packages/plugin-embeddings-openai, packages/plugin-embeddings-transformers, packages/plugin-memory

**What / why:** transformers embedder caches a failed extractor load forever (permanent brick on transient error) and normalizeShape can misalign vectors with inputs; openai embedder returns undefined dim on unknown model, silently corrupting the index; memory consolidate collision guard uses stale byName; embedding-cache reloads+parses the whole vector cache per recall and listEntries parses every .md sequentially (await-in-loop).

**Rationale / risk:** Memory subsystem correctness + recall-path perf. Medium risk; re-audit the subsystem and add tests for the failure-cache and shape-alignment paths.

**Affected files & merged findings:**

- **[u84-1 · review/medium/confirmed]** Failed extractor load is cached forever — embedder permanently bricked on transient error
  - Files: `packages/plugin-embeddings-transformers/src/embedder.ts` (L67-77)
  - Fix: Wrap the load so a rejection clears the latch: `this.extractorPromise = (async () => {...})().catch((e) => { this.extractorPromise = null; throw e; });` (or try/finally that nulls extractorPromise when extractor was not set). Keep the success-path caching of this.extractor.
  - Test: Add a vitest case: pipelineFactory that rejects on first call, resolves on second; assert first embed() throws, second embed() succeeds and factory was retried (factoryCalls===2).
- **[u84-2 · review/medium/confirmed]** normalizeShape silently misaligns vectors with inputs when batch count != expected
  - Files: `packages/plugin-embeddings-transformers/src/embedder.ts` (L109-127)
  - Fix: In the 2D branch verify `data.length === expected` (return [] or throw on mismatch, matching the 3D branch's invariant). Better: throw a descriptive error so a misbehaving model surfaces loudly instead of corrupting the index.
  - Test: Unit test: stub factory returns 1 vector for a 2-text batch; assert normalizeShape/embed rejects or returns [] rather than a length-1 array. Cover the symmetric long-batch case.
- **[u83-1 · review/medium/confirmed]** Unknown config model makes dim return undefined, silently corrupting the memory index
  - Files: `packages/plugin-embeddings-openai/src/embedder.ts; packages/plugin-embeddings-openai/src/index.ts` (L58-60)
  - Fix: Validate the model in the constructor (or createClient): if MODEL_DIM[model] is undefined AND no explicit dimensions override is supplied, throw a clear error ('unknown OpenAI embedding model X; set embeddings.dimensions or use a known model'). selectEmbedder already catches activation errors and falls back to TF-IDF (cli/src/setup/embedder.ts:38-45), so throwing yields a graceful, logged fallback instead of a silent undefined-dim index.
  - Test: Add a unit test: new OpenAIEmbedder({ model: 'bogus' as any }) without dimensions throws; with dimensions set it succeeds and dim returns the override. Add a config-applier/setup test asserting an unknown model falls back to TF-IDF with a warn.
- **[u87-2 · review/medium/confirmed]** consolidateMemory's collision guard uses a stale byName, can clobber an entry merged earlier in the same run
  - Files: `packages/plugin-memory/src/consolidate.ts` (L138-215)
  - Fix: After a successful merge save, record the produced name in a `produced` Set (or byName.set(parsed.name, ...)) and include `produced` in the collision check so a later cluster can't clobber an already-merged entry; record it as not-merged instead.
  - Test: Two tag-clusters whose fake LLM replies both return name 'foo'; assert the second cluster is recorded into:null and the first merge's body survives.
- **[u87-1 · perf/medium/confirmed]** EmbeddingIndex.load() re-reads + JSON.parses the whole vector cache on every recall
  - Files: `packages/plugin-memory/src/embedding-cache.ts; packages/plugin-memory/src/store/search.ts` (L48-63)
  - Fix: Add a `private loaded = false` guard in EmbeddingIndex.load() that returns early once the file has been read (set it even on ENOENT). The flush() already keeps disk in sync for this process's writes; the single-writer invariant means re-reading is unnecessary. This drops recall from O(cacheBytes) parse per call to O(1) after warmup.
  - Test: Spy on fs.readFile; assert it is invoked at most once across N successive recalls on one store instance; assert recall results stay correct (cache still consulted).
- **[u88-1 · perf/medium/confirmed]** listEntries reads+parses every .md file sequentially (await-in-loop) on the recall hot path
  - Files: `packages/plugin-memory/src/store/io.ts` (L42-57)
  - Fix: Collect the .md dirents, then `await Promise.all(candidates.map(async (d) => { const raw = await fs.readFile(...); ... }))` and filter/build entries from the resolved results. Reads fan out concurrently; parsing stays in JS. Optionally cap concurrency (e.g. p-limit-style) if 500 simultaneous FDs is a concern, but Node handles this fine at these counts.
  - Test: Add a test that writes N entries then times/asserts recall completes; or inject a fs spy and assert reads are issued before earlier reads resolve. Existing store.test.ts incremental-index test already proves correctness of the result set.
- **[u87-5 · review/low/unverified-lowrisk]** Consolidation sends literal model id 'unknown' and tolerates inverted JSON braces
  - Files: `packages/plugin-memory/src/consolidate.ts` (L163-178, 220-229)
  - Fix: Throw a clear error if provider.models is empty before streaming; in extractJson add `if (start === -1 || end <= start) throw ...` so malformed output yields the intended message.
  - Test: Unit test extractJson with input where '}' precedes '{' expects the 'no JSON object' error; test consolidateMemory with a models:[] provider expects a descriptive throw.
- **[u87-7 · test-gap/low/unverified-lowrisk]** memory-consolidate onBeforeProviderCall nudge hook has no test for the per-session one-shot flag
  - Files: `packages/plugin-memory/src/consolidate.ts` (L240-265)
  - Fix: Ensure consolidate-nudge.test.ts asserts: (a) no nudge at exactly threshold entries, nudge at threshold+1; (b) only one nudge across repeated calls; (c) an existing req.system is preserved with the hint appended (not replaced).
  - Test: As described in fix.

### [t2-lifecycle-shutdown] Fix session/channel lifecycle leaks and missing shutdown re-entrancy

- **Lens:** review | **Risk:** medium | **Effort:** M | **Findings merged:** 7
- **Packages:** packages/cli, packages/core, packages/isolator-subprocess, packages/plugin-channel-mobile, packages/plugin-terminal

**What / why:** schedule run boots a full init-hook session but never closes it (daemon/port leak); self-hosted channel shutdown has no re-entrancy guard (double SIGINT runs it twice); channel-mobile startWsBridge failure leaks log subscription + session resolvers; wizard module-global stdin readline never closed; retained-child subagent registry is a module-level global so one Session.close wipes ALL sessions children; terminal getSharedTerminal create race orphans a live PTY.

**Rationale / risk:** Lifecycle/shutdown correctness (invariant #9 wiring). Medium risk touching process exit paths; add re-entrancy + teardown tests.

**Affected files & merged findings:**

- **[u24-1 · review/medium/confirmed]** `schedule run` boots a full init-hook session but never closes it (daemon/port + onShutdown leak)
  - Files: `packages/cli/src/commands/schedule/handlers.ts` (L106-130)
  - Fix: Wrap the body in try/finally and `await session.close('schedule-run')` in the finally. `run` only needs a provider-activated session to dispatch one turn — it does not need the scheduler poller or webhooks listener running, so prefer booting without those daemons (or close immediately after the single turn) to avoid the poller double-firing and the webhooks port bind during the run.
  - Test: Inject a fake setup and assert session.close is awaited even when runSchedule throws; assert no init-hook daemon (poller/webhooks) is left running after runScheduleNow returns.
- **[u25-1 · review/medium/confirmed]** Self-hosted channel shutdown has no re-entrancy guard (double SIGINT/SIGTERM runs it twice)
  - Files: `packages/cli/src/commands/start-registered-channel.ts` (L151-160)
  - Fix: Mirror the attached-path pattern: add `let stopping = false;` and early-return when already shutting down before running the teardown sequence.
  - Test: Unit-test shutdown idempotence: invoke the handler twice and assert handle.stop / session.close are each called at most once (inject mocks for handle/session/runnerServer).
- **[u71-1 · review/medium/confirmed]** startWsBridge failure leaks the log subscription + installed session resolvers (no teardown)
  - Files: `packages/plugin-channel-mobile/src/channel.ts` (L108-131)
  - Fix: Wrap the post-wire startup in try/catch (or move host.wire() to AFTER startWsBridge succeeds): on any failure between wire() and returning the handle, call host.dispose() and `await this.tunnel?.close()` before rethrowing. Set this.host/this.server back to null in the catch.
  - Test: Add channel.test.ts: stub startWsBridge to reject; assert host.dispose was invoked (session.log unsubscribed, setApprovalResolver(null) called) and that the rejection propagates.
- **[u30-2 · review/medium/confirmed]** Module-global stdin readline never closed; mutable queue/waiter state is not re-entrant or test-safe
  - Files: `packages/cli/src/wizard/auth-context.ts` (L55-92)
  - Fix: Encapsulate the reader + queue + waiters per buildProviderAuthContext call (closure or small class) instead of module globals, and close the readline when the login flow ends (return/throw). At minimum expose a teardown called in a finally in login.ts/init.ts, and reset stdinEnded/lineQueue/lineWaiters on each new reader so the same process can run login twice.
  - Test: Unit test piping scripted lines through two sequential stdinLinePrompt sessions in one process; assert the second reads fresh lines (not '' from stale stdinEnded) and that the readline is closed after a login completes.
- **[u47-1 · review/medium/confirmed]** Retained-child registry is a module-level global; one Session.close() wipes ALL sessions' children
  - Files: `packages/core/src/subagents/registry.ts` (L27-43)
  - Fix: Scope the registry to the Session instance: store the `Map` on `SessionRuntime` (e.g. `session.retainedChildren`) and have `runChildTurn`/`continueChildTurn` read/write `rt.parentSession.retainedChildren`; `close()` clears only its own map. Keep the module API as thin wrappers taking a session, or move it onto SessionRuntime entirely.
  - Test: Add a test: register a retained child via session A, construct + close session B, assert session A's child is still retrievable; close A and assert it is gone.
- **[u112-2 · review/medium/confirmed]** getSharedTerminal has a create race that orphans a live PTY
  - Files: `packages/plugin-terminal/src/terminal.ts` (L12-21)
  - Fix: Memoize the in-flight promise: keep a `Map<string, Promise<TerminalProcess>>`; on miss store the promise synchronously before awaiting, and on the created proc's exit clear both maps. Mirror the per-instance promise-mutex pattern used elsewhere for read-modify-write singletons.
  - Test: Unit test: call getSharedTerminal(cwd) twice without awaiting between calls (Promise.all) and assert the two resolved processes are identical (===) and only one createTerminalProcess spawn happened (spy).
- **[u62-4 · test-gap/low/confirmed]** No test covers the env-restriction security property (this isolator's headline feature)
  - Files: `packages/isolator-subprocess/src/index.ts` (L200-212)
  - Fix: Add a test: set process.env.MOXXY_SECRET='leak' in the parent, run a fixture handler that returns Object.keys(process.env) (via ctx-independent direct access — note: node:process is allowed by the loader), assert MOXXY_SECRET absent and PATH present with default allowlist; and present when caps.env includes it.
  - Test: As described; pairs with u62-2's fix verification.

### [t2-perf-quadratic-misc] Fix the remaining quadratic / unbounded hot paths

- **Lens:** perf | **Risk:** medium | **Effort:** M | **Findings merged:** 15
- **Packages:** apps/desktop, packages/client-core, packages/core, packages/plugin-cli, packages/plugin-computer-control, packages/plugin-scheduler, packages/plugin-terminal, packages/plugin-webhooks, packages/plugin-workflows, packages/tools-builtin

**What / why:** TUI StreamingPreview re-splits the growing delta per chunk; terminal runCommand re-scans full output + rebuilds RegExp per chunk and scrollback concat+slice copies the cap per chunk; grep reads every file fully with no size cap/binary detection; webhooks readJsonPath re-parses the body per filter rule; UsagePanel Math.max spreads an unbounded array (RangeError); scheduler does one atomic write per changed row; DAG wave executes sequentially despite a concurrency setting; usage.perCall / seenIds grow unbounded; surfaceInputParamsSchema JSON.stringifies every input frame; ChatSurface search stringifies every tool input per keystroke; runProcess O(n^2) stdout copy.

**Rationale / risk:** A batch of contained complexity fixes, each O(n^2)->O(n) or bounded-growth. Medium risk only because a few touch streaming output; add micro-benchmarks/equivalence assertions.

**Affected files & merged findings:**

- **[u76-1 · perf/medium/confirmed]** StreamingPreview re-splits the entire growing delta per chunk → O(n^2) over a stream
  - Files: `packages/plugin-cli/src/components/chat/StreamingPreview.tsx` (L30-60)
  - Fix: Operate on the tail only: take `content.slice(-Math.max(innerCols*2, 256))` (or have ChatView pass an actually-truncated tail via tailForViewport) before splitting, and find the last newline with `lastIndexOf('\n')` instead of full `split`. Replace the parent `streamingDelta.trim()` truthiness guard with a cheap `streamingDelta.length > 0 && !/^\s*$/.test(...)`-on-tail check, or memoize.
  - Test: Unit test the new tail-extraction helper: feed a multi-line buffer and assert it returns the last non-empty line truncated to innerCols, and that it only inspects a bounded suffix (e.g. spy/benchmark that work is bounded regardless of total length).
- **[u112-3 · perf/medium/confirmed]** runCommand re-scans full accumulated output and rebuilds RegExp on every data chunk (O(n^2))
  - Files: `packages/plugin-terminal/src/terminal.ts` (L134-141)
  - Fix: Compile the marker RegExp once outside the closure (marker is fixed per call). Only scan the new tail: keep a search cursor and run exec from `Math.max(0, acc.length - chunk.length - markerLen)` or scan `d` plus a small carry-over buffer of the last markerLen-1 chars to catch a split sentinel, instead of re-scanning all of acc.
  - Test: Unit test runCommand against a fake TerminalProcess that emits many small chunks then the sentinel; assert completion + that the matcher is invoked on bounded-size input (or benchmark large-output case).
- **[u112-7 · perf/low/confirmed]** Scrollback buffer concat+slice copies the full cap on every chunk once saturated
  - Files: `packages/plugin-terminal/src/pty.ts` (L96-97)
  - Fix: Append to an array of chunks and lazily join/trim in scrollback(), or keep a ring buffer / only slice when length exceeds cap + a hysteresis margin (e.g. slice when length > 1.5*cap down to cap) to amortize the copy.
  - Test: Benchmark emitData with many small chunks past the cap; assert scrollback length stays <= cap and content is the tail.
- **[u128-2 · perf/medium/confirmed]** Grep reads every file fully into memory with no size cap and no binary detection
  - Files: `packages/tools-builtin/src/grep.ts` (L75-88)
  - Fix: Before reading: `const st = await fs.stat(full)`; skip files above a cap (e.g. 5-10 MB). After reading the first chunk (or whole small file), skip if it contains a NUL byte (binary heuristic, like ripgrep). Optionally stream large files line-by-line via readline instead of slurping.
  - Test: Unit test: a dir with a 20MB file and a binary file (containing 0x00) plus a normal .ts file — assert the big/binary files are skipped and the .ts match is still returned; assert peak behavior via a size-capped fixture.
- **[u116-1 · perf/medium/confirmed]** readJsonPath re-parses the entire request body once per jsonPath filter rule
  - Files: `packages/plugin-webhooks/src/filter.ts` (L37-67)
  - Fix: Parse the body once per shouldFire() call: in shouldFire, attempt JSON.parse(body) a single time into `parsedBody` (or null), thread it (plus the string form for headers) through ruleMatches/readJsonPath so jsonPath lookups index into the already-parsed object. Cache the toString('utf8') too.
  - Test: Unit test shouldFire with a body and a JSON.parse spy: assert parse called exactly once regardless of how many jsonPath rules are present across include+exclude.
- **[u75-3 · review/medium/confirmed]** Math.max(...series) spreads an UNBOUNDED per-call array → RangeError in long sessions
  - Files: `packages/plugin-cli/src/components/UsagePanel.tsx` (L317)
  - Fix: Compute peak with a reduce: `series.reduce((m,v)=>v>m?v:m, 0)` (O(n), no spread), or peak over the same tail the sparkline shows.
  - Test: Unit-test a helper `peak(series)` against a large array and assert it returns the max without throwing; the inline spread throws on the same input.
- **[u103-3 · perf/medium/confirmed]** syncSkillSchedules does one full atomic file write per changed row instead of one batched write
  - Files: `packages/plugin-scheduler/src/skill-sync.ts; packages/plugin-scheduler/src/store.ts` (L65-103)
  - Fix: Add a batch reconcile method to ScheduleStore (e.g. `reconcileSkillSchedules(wantedMap)`) that performs the whole add/remove/update diff inside a single `mutate` call -> one JSON.stringify + one atomic write. syncSkillSchedules computes the diff and hands the final array to one mutation.
  - Test: Spy on writeFileAtomic (or count fs writes) across a sync that adds 3 + updates 2 + removes 1 skill schedule; assert exactly one write. Keep existing skill-sync.test.ts assertions on added/removed/updated counts.
- **[u117-1 · perf/medium/confirmed]** "DAG runs waves up to concurrency" but the wave executes strictly sequentially
  - Files: `packages/plugin-workflows/src/executor/dag.ts` (L284-361)
  - Fix: Partition the wave into 'pure' steps (tool/prompt/skill/nested-workflow — no shared-state mutation) and 'serializing' steps (logic/branch/loop/awaitInput). Run pure steps via the spawner's existing `spawnAll`/Promise.all up to `concurrency`, then settle their outcomes; keep state-mutating steps sequential. Apply each step's outcome (status/vars/branch) after the batch resolves, preserving deterministic vars-merge order.
  - Test: Inject a spawner whose `spawn` resolves on a deferred that only settles once K concurrent calls are in flight; assert the fan-out of K independent steps does not deadlock (proving true overlap), and assert serial logic-step ordering is preserved.
- **[u31-4 · perf/low/confirmed]** usage.perCall grows unbounded (one entry per provider call) for the lifetime of the workspace slot
  - Files: `packages/client-core/src/chat-store/usage.ts` (L60-68)
  - Fix: Cap perCall to the last N (e.g. 200) entries with a ring/slice, or store only what the sparkline renders; the totals already capture the cumulative numbers so trimming perCall is lossless for the meter.
  - Test: Feed >cap provider_response events; assert perCall.length === cap and totals still reflect all calls.
- **[complexity-hotspots-13 · perf/low/unverified]** Per-workspace seenIds Set and the live in-memory log grow unbounded for the session lifetime
  - Files: `packages/client-core/src/chatModel.ts; packages/client-core/src/chat-store/state.ts` (LchatModel.ts:138, 184-195; state.ts:125)
  - Fix: Bound the live window: evict from the head of the ChunkedBlockLog (and corresponding seenIds) beyond a generous in-memory cap (e.g. last 2-5k events), backed by the disk pagination that already exists for scroll-up. Have buildSnapshot hand the Transcript a windowed tail rather than the full toArray().
  - Test: Long-session simulation: append 50k events, assert in-memory log/seenIds stay capped and scroll-up still pages older events from disk.
- **[u1-3 · perf/low/confirmed]** Search filter JSON.stringify's every tool input on each query change over the full event log
  - Files: `apps/desktop/src/chat/ChatSurface.tsx` (L55-70)
  - Fix: Either (a) precompute a lowercased searchable string per event once (memoized on chat.events alone) and reuse it across keystrokes, or (b) match only e.name and a shallow stringify of small inputs, or (c) debounce searchQuery. Option (a) removes the per-keystroke stringify cost.
  - Test: Benchmark filter over a synthetic 5k-event log with large tool inputs while typing; assert no JSON.stringify in the per-keystroke path (spy/count). Correctness: existing filter results unchanged.
- **[u81-1 · perf/low/confirmed]** runProcess re-copies whole stdout buffer per chunk (O(n^2)); runProcessBinary already does it right
  - Files: `packages/plugin-computer-control/src/shell.ts` (L59-61)
  - Fix: Collect chunks into a `const chunks: Buffer[] = []`, push in the data handler, and `Buffer.concat(chunks).toString('utf8')` in the close handler — identical to runProcessBinary. This also lets the two helpers share a single core spawn routine (see u81-3 atomicity note).
  - Test: Unit test: spawn a process that emits stdout in many small chunks (e.g. `node -e 'for(...)process.stdout.write(...)'`) and assert the full string is captured; a perf/regression test isn't strictly needed but a multi-chunk correctness test guards the rewrite.
- **[u9-1 · perf/medium/confirmed]** NodeStep mounts a 2nd useOnboarding() instance — duplicate probes + progress subscription
  - Files: `apps/desktop/src/onboarding/steps/NodeStep.tsx; apps/desktop/src/onboarding/Onboarding.tsx` (L27-27)
  - Fix: Lift the single useOnboarding(phase) instance in Onboarding.tsx and pass the slice NodeStep needs (node, installNode, refresh, openExternal) down as props, or via context. NodeStep should not instantiate its own hook. This collapses to one probe pair + one progress subscription and removes the phase-asymmetry.
  - Test: Render Onboarding with a mocked api(); assert onboarding.probeNode is invoked once (not twice) when the node step is active, and that only one onboarding.install.progress subscribe call is made.
- **[u45-2 · perf/low/confirmed]** writeIndex() re-runs ensureDir()+ensureLogFile() (open+close syscalls) on every 250ms index flush
  - Files: `packages/core/src/sessions/persistence.ts` (L234-256)
  - Fix: Run ensureDir()+ensureLogFile() once (guard with a memoized `private ready: Promise<void>` created in the constructor/attach) and drop ensureLogFile from writeIndex entirely — writeFileAtomic already mkdir-p's the sidecar's dir, and the .jsonl is owned by the append path. writeIndex then just needs writeJsonAtomic.
  - Test: Spy on fs.open and assert it is not called from the index-write path after the first flush; keep existing readIndex/restore tests green.
- **[complexity-hotspots-9 · perf/low/unverified]** Session JSONL append recreates the whole meta object per event (allocation churn on chatty turns)
  - Files: `packages/core/src/sessions/persistence.ts` (L151-171)
  - Fix: Track eventCount/lastActivity/firstPrompt as plain mutable fields and only materialise the immutable SessionMeta object inside writeIndex() (which already runs at most every 250ms). Compute the ISO timestamp once at flush time.
  - Test: Assert the sidecar contents are unchanged after a burst of events; confirm firstPrompt is still captured from the first user_prompt.

### [t2-confirmed-logic-bugs] Fix the remaining confirmed correctness bugs (UI + protocol + parsing)

- **Lens:** review | **Risk:** medium | **Effort:** M | **Findings merged:** 25
- **Packages:** apps/desktop, packages/client-core, packages/core, packages/mode-default, packages/plugin-cli, packages/plugin-commands, packages/plugin-provider-admin, packages/plugin-scheduler, packages/plugin-self-update, packages/plugin-stt-whisper, packages/plugin-telegram, packages/plugin-workflows, packages/sdk, packages/workflows-builder

**What / why:** SkillsView load effect depends on whole s object -> refetch clobbers unsaved edits; yaml stripComments mangles # inside block-scalar prompt bodies (round-trip data loss); command-palette steppers assume multi-token names that do not exist (broken vault Args); use-turn-runner stale-closure drops a force-sent priority message; /compact never passes provider/model (forces lossy digest); telegram splitForTelegram splits composed HTML on raw boundaries breaking tags; workflows-builder loop-exit ambiguity + serialize bugs; scheduler cron timezone mismatch + skill-schedule delete/edit never propagate; askStore.respond swallows IPC failure (runner hangs); WorkspaceFiles reloadSignal IPC inside a setState updater; mode-default retryable error continues with zero backoff/unbounded; dispatchToolCall hands hooks empty cwd/env; whisper bypasses normalizeWhisperUpload; /new and /clear leave the priority slot; provider_add rollback unregisters instead of restoring; toposort keys mismatch (packageName vs declared name).

**Rationale / risk:** A batch of independently confirmed correctness bugs that do not share a structural theme but each warrant a targeted fix + regression test. Medium risk spread across many packages.

**Affected files & merged findings:**

- **[u11-1 · review/high/confirmed]** SkillsView load effect depends on whole `s` object → refetch clobbers unsaved edits
  - Files: `apps/desktop/src/settings/SkillsView.tsx` (L46-58)
  - Fix: Depend on `[active, s.readSkill]` (a stable callback) instead of the whole `s`. Optionally guard the overwrite: only `setBody`/`setServerBody` when not `dirty`, or key the fetch to `active` only and ignore stale resolutions.
  - Test: Render SkillsView, pick a skill, edit the textarea, then fire SESSION_INFO_REFRESH_EVENT (or trigger a refresh that flips loading) and assert the edited body is preserved (dirty stays true).
- **[u129-1 · review/high/confirmed]** stripComments mangles `#` inside block-scalar prompt bodies → round-trip data loss
  - Files: `packages/workflows-builder/src/yaml.ts` (L147-172, 134-139)
  - Fix: Do comment-stripping during the structural parse, not as a global pre-pass: skip stripping inside `|`/`>` block-scalar regions (track when parseBlockScalar is consuming lines), or strip per-line only in parseMap/parseSequence scalar context. Simplest: drop the global stripComments pre-pass and have splitKey/parseScalar ignore trailing bare `#` only on non-block lines.
  - Test: Add a round-trip test: a prompt block scalar containing `# Heading` and `text # inline` lines must survive serialize→fromYaml unchanged. Also a full-line `#`-leading prompt line.
- **[u4-1 · review/high/confirmed]** Stepper keys assume multi-token command names that don't exist; vault Args form dispatches broken args
  - Files: `apps/desktop/src/chat/command-palette/steppers.ts; apps/desktop/src/chat/command-palette/CommandPalette.tsx` (L11-29)
  - Fix: Model the subcommand explicitly: change COMMAND_STEPPERS to map registered single-token command name -> { subcommand?: string; steps: ArgStep[] } (e.g. vault -> { subcommand:'set', steps:[key,value] }), drop the startsWith fuzzy fallback, and have run() prepend the subcommand so it dispatches `name:'vault', args:'set KEY VALUE'`. Remove the dead 'mode use'/'provider use' entries (no such commands) or wire them to real picker actions. Add a unit test asserting stepsForCommand('vault') and the constructed argString round-trip to `set <key> <value>`.
  - Test: Unit test stepsForCommand for the real command names + a run() arg-construction test with a fake api().invoke spy asserting the exact { name, args } sent for vault set; integration: pick 'vault' action in palette, fill key/value, assert no 'unknown subcommand' error block lands in the transcript.
- **[u79-1 · review/high/confirmed]** Stale-closure: force-sent priority message skipped at end of the in-flight turn
  - Files: `packages/plugin-cli/src/session/use-turn-runner.ts` (L56-114)
  - Fix: Mirror priorityMessage into a ref (priorityRef) updated in setPriorityMessage/forceSendFirst alongside the state setter, and read priorityRef.current in the finally block (also clear it there). Mirrors the existing busy/busyRef pattern. queueRef is already a ref so it is correct.
  - Test: Unit-test the hook with @testing-library/react renderHook + a fake Session whose runTurn yields then resolves on a controllable promise: start a turn, call forceSendFirst() while busy, resolve the turn, assert runTurn is next invoked with the force-sent text exactly once and alone (queue not merged in).
- **[u80-1 · review/high/confirmed]** /compact never passes provider/model to compact() — forces lossy digest, never a real summary
  - Files: `packages/plugin-commands/src/index.ts` (L162-171)
  - Fix: Resolve the active provider once (s.providers?.getActive()) and pass `provider` plus `model: provider?.models[0]?.id` into the compact() ctx, mirroring runCompactionIfNeeded. Better: delegate the whole manual compaction to the shared SDK helper with a `force` flag rather than reimplementing it here.
  - Test: Add a test whose CompactSessionShape exposes providers.getActive() and a compactor whose compact() asserts ctx.provider is defined; assert /compact yields the provider-written summary path, not the truncation fallback.
- **[u111-3 · review/medium/confirmed]** splitForTelegram splits already-composed HTML on raw char/newline boundaries, breaking tags/entities
  - Files: `packages/plugin-telegram/src/render.ts` (L301-312)
  - Fix: Make splitForTelegram HTML-aware: prefer splitting only at boundaries that are outside any open tag and outside `<pre>`/`<code>` fences (close the fence in the head part and reopen it in the tail), or split the structured RenderedFrame fields (body/diff blocks) at the model layer before HTML conversion so each part is self-contained valid HTML. At minimum, never cut inside `&...;` entities or `<...>` tags.
  - Test: Unit test splitForTelegram with input containing a >limit `<pre><code class="language-diff">...</code></pre>` block and assert every returned part is independently valid HTML (balanced tags, no truncated entity).
- **[u129-2 · review/medium/confirmed]** Loop exit has no stored field; multiple steps with needs:[loop] yield ambiguous/inconsistent rendering
  - Files: `packages/workflows-builder/src/serialize.ts; packages/workflows-builder/src/operations.ts` (L276-284, 279-296)
  - Fix: Make the exit explicit: store it (e.g. loop.exit?: string) or forbid more than one non-body needs:[loop] in connectNeeds/setLoopExit (reject/replace). At minimum, have setLoopExit scrub ALL non-body needs:[loop] before wiring the new target, and have connectNeeds refuse adding needs:[loop] to a non-body step (route it through setLoopExit).
  - Test: Test: setLoopExit(loop,'a'); connectNeeds(loop,'b'); assert exactly one loop-exit edge and deterministic target regardless of node order; assert 'b' is either rejected or also treated as exit consistently.
- **[u103-1 · review/high/confirmed]** nextFireTime with explicit timeZone reads parts in target zone but jumps in system-local zone
  - Files: `packages/plugin-scheduler/src/cron.ts` (L122-245)
  - Fix: Make the cursor walk operate consistently in the target zone. Simplest correct approach: convert the cursor to the target zone's wall-clock components, do all arithmetic on those components, then map back to an absolute instant (e.g. via a fixed-offset computation per candidate, or by re-anchoring with `Intl` + offset lookup). Alternatively, since the per-minute fallback already exists, drop the field-jump optimization when `timeZone` is a non-local explicit zone and walk minute-by-minute using `decomposeInZone` for matching only (slower but correct, capped at 1 year).
  - Test: Add cron.test.ts cases passing timeZone='America/New_York' and 'Asia/Tokyo' from a host pinned to UTC (set TZ=UTC in vitest env): assert `nextFireTime('0 9 * * *', after, 'America/New_York')` returns the instant that is 09:00 New-York wall-clock, and a DST-boundary case (spring-forward day).
- **[u103-2 · review/high/confirmed]** Skill-schedule deletes/edits never propagate: poller never rescans, only skill_created re-syncs
  - Files: `packages/plugin-scheduler/src/index.ts; packages/plugin-scheduler/src/skill-sync.ts; packages/plugin-scheduler/src/poller.ts` (L116-130)
  - Fix: Either (a) actually call `syncSkillSchedules(opts.skills, store)` at the top of each poller tick when `opts.skills` is set (the idempotent no-write-when-unchanged property makes this cheap), passing skills into the poller; or (b) subscribe to skill removal/update events too. Then correct both doc comments to match reality.
  - Test: Integration test: create skill schedule via syncSkillSchedules, then drop the skill from the registry and run a poller tick (with skills wired) — assert the skill row is gone. Also assert a same-name skill with a changed cron updates without a fresh skill_created.
- **[u32-2 · review/medium/confirmed]** askStore.respond drops the ask optimistically but swallows IPC failure — runner can hang parked
  - Files: `packages/client-core/src/askStore.ts` (L35-40)
  - Fix: Await the invoke and re-insert the ask (or surface an error) on failure, OR only drop the ask after the IPC resolves. At minimum log/report the rejection instead of swallowing it so the parked runner isn't silently stranded.
  - Test: Test that respond() with a rejecting fake transport re-surfaces the ask (or emits an error) rather than leaving the store empty; add askStore.test.ts.
- **[u13-1 · review/medium/confirmed]** reloadSignal effect fires IPC loads from inside a setExpanded updater (StrictMode double-invoke)
  - Files: `apps/desktop/src/shell/WorkspaceFiles.tsx` (L120-127)
  - Fix: Hold the current expanded set in a ref (or lift it into the effect deps) and iterate it directly in the effect body instead of inside the setExpanded updater: keep an `expandedRef` synced to state, then `for (const p of expandedRef.current) if (p !== '.') void load(p);`. The updater should never have side-effects.
  - Test: Render WorkspaceFiles in StrictMode with a mocked api().invoke('workspace.listDir'), expand two folders, bump reloadSignal, and assert listDir is called exactly once per expanded path + once for '.' (not 2x).
- **[u66-1 · review/medium/confirmed]** Retryable provider error continues with zero backoff and no bounded retry count
  - Files: `packages/mode-default/src/turn-iterator.ts` (L117-127)
  - Fix: Add an exponential-backoff sleep (await ctx.sleep / setTimeout-based, abort-aware via ctx.signal) before `continue` on the retryable branch, and a bounded consecutive-retry counter (reset on any clean call, like reactiveCompactions) that converts to a fatal error after N attempts. Ideally factor a shared `retryProviderCall` helper in @moxxy/sdk/mode-helpers so default/goal/deep-research all back off identically (consistency).
  - Test: FakeProvider script that yields a retryable error event then a textReply; assert the loop emits the retryable error event, waits (inject a fake sleep and assert it was called with increasing delays), then succeeds. Add a second test where the provider yields retryable errors indefinitely and assert the loop gives up with a fatal error after the bounded retry count rather than running to maxIterations.
- **[u124-1 · review/medium/confirmed]** dispatchToolCall hands onToolCall hooks empty cwd:'' and env:{} — contract violation
  - Files: `packages/sdk/src/tool-dispatch.ts` (L27-35)
  - Fix: Add `readonly cwd: string` and `readonly env: Readonly<Record<string,string|undefined>>` to ModeContext (populated by core/run-turn from the session), then thread `ctx.cwd`/`ctx.env` into the dispatchToolCall hook ctx here instead of the empty literals. Also pass `cwd: ctx.cwd` in the tools.execute opts at line 63 so the tool sees the per-session cwd rather than registry default.
  - Test: Add a mode-default/goal integration test that registers an onToolCall hook asserting ctx.cwd === session cwd and ctx.env is the session env; today it would observe '' / {}.
- **[u108-1 · consistency/medium/confirmed]** WhisperTranscriber bypasses normalizeWhisperUpload; can't WAV-wrap the project's raw-PCM MIME
  - Files: `packages/plugin-stt-whisper/src/whisper.ts; packages/plugin-stt-whisper/src/audio.ts` (L73-79)
  - Fix: Replace whisper.ts:73-79 with `const upload = normalizeWhisperUpload(audio, opts.mimeType); const file = new File([upload.bytes], upload.filename, { type: upload.mimeType });` so PCM16 is WAV-wrapped and filename inference is shared. Then delete the duplicate DEFAULT_FILENAMES table.
  - Test: Add a test in this package: transcribe(rawPcm, { mimeType: MOXXY_PCM16_24KHZ_MIME }) and assert the File handed to client.audio.transcriptions.create has a RIFF/WAVE header (first 4 bytes 'RIFF', bytes 8-11 'WAVE') and type 'audio/wav'.
- **[u78-1 · review/medium/confirmed]** /new and /clear reset leaves the priority (force-send) message slot unrcleared
  - Files: `packages/plugin-cli/src/session/SessionView.tsx` (L198-249)
  - Fix: Expose setPriorityMessage on TurnRunnerHandle and call turn.setPriorityMessage(null) in the 'new'/'clear' branch of performSessionAction; or have the abort path in runTurnWith skip the drain when the turn was aborted for a session reset.
  - Test: Render SessionView, queue+force-send a message mid-turn, dispatch /new, assert no further runTurn fires after reset.
- **[u93-1 · review/medium/confirmed]** provider_add rollback unregisters the prior def instead of restoring it on write failure
  - Files: `packages/plugin-provider-admin/src/index.ts` (L204-215)
  - Fix: Mirror configure()'s rollback: capture the prior def before mutating (e.g. const prevDef = providerRegistry.list().find(p => p.name === entry.name)) and in the catch do `if (wasRegistered && prevDef) providerRegistry.replace(prevDef); else providerRegistry.unregister(entry.name);`. Factor the register/replace+rollback dance into one shared helper used by both provider_add and configure to keep them in lockstep.
  - Test: Unit test: seed the FakeRegistry with an existing 'zai' def, stub upsertStoredProvider to reject, call provider_add with the same slug, assert the registry STILL has the original def (not deleted). Repeat for the wasRegistered=false case asserting it is unregistered.
- **[u41-1 · review/medium/confirmed]** Plugin-dep toposort resolves edges by packageName but the readiness gate keys plugins by declared name
  - Files: `packages/core/src/plugins/toposort.ts; packages/core/src/plugins/host.ts` (L60-69)
  - Fix: Standardize kind:'plugin' requirements on packageName and have registerPlugin store under packageName (host.ts already keys `loaded` by manifest.packageName for exactly this reason). Or register under both names. Document the convention on MoxxyRequirement.
  - Test: Integration test where dependent declares kind:'plugin', name:<dep packageName> while the dep's declared plugin.name differs from its packageName; assert BOTH correct load order AND that the readiness gate is satisfied.
- **[u80-3 · review/medium/confirmed]** Appends compactor result with no defensive sessionId/turnId/source fill — type-compliant compactor emits invalid event
  - Files: `packages/plugin-commands/src/index.ts` (L177)
  - Fix: Build the emittable defensively: spread result over { sessionId: s.id?/ctx.sessionId, turnId, source: 'compactor' } before append — or reuse the SDK helper (see u80-2) which already does this. Add the sessionId/turnId fields to CompactSessionShape so they are available.
  - Test: Add a /compact test whose compactor returns ONLY the Omit<CompactionEvent, keyof EventBase> fields; assert the appended event carries sessionId, turnId, and source:'compactor'.
- **[u46-2 · review/medium/confirmed]** skill_created / skill_invoked events mint a fresh orphan turnId instead of the active turn's
  - Files: `packages/core/src/skills/synthesize.ts` (L94-104,218-226)
  - Fix: Thread the active turnId through: have the tool handlers accept `(input, ctx)` and pass ctx.turnId into synthesizeSkill (add a turnId param) and into the load_skill skill_invoked append. synthesizeSkill has only this one caller, so the signature change is safe.
  - Test: Unit test: drive a turn that calls synthesize_skill/load_skill and assert the emitted skill_created/skill_invoked event.turnId equals the turn's turnId (and survives the run-turn subscriber filter).
- **[u47-4 · test-gap/medium/unverified-lowrisk]** No tests for the retained continue()/release() flow, tool filtering, or child->parent event mapping
  - Files: `packages/core/src/subagents/run-child.ts; packages/core/src/subagents/events.ts; packages/core/src/subagents/tools.ts` (L143-184,124-160,4-19)
  - Fix: Add unit tests: spawn with retainSession then continue() and assert a second turn ran + subagent_completed fired once + entry released; release() drops without completing; allowedTools restricts list/get and rejects disallowed execute; a child emitting tool_call/tool_result/error produces the expected subagent_* parent events; unknown mode emits subagent_warning and runs on default; missing default yields the error result.
  - Test: Extend run-child.test.ts using the existing echo-model/Session harness plus a mode that emits tool_call_requested/tool_result/error to assert parent-log mapping.
- **[u106-5 · review/low/unverified-lowrisk]** On the capping verify failure, the snapshot is restored + plugin reloaded twice
  - Files: `packages/plugin-self-update/src/index.ts` (L227-241, 628-643)
  - Fix: Pass a flag (e.g. alreadyRestored) into escalate, or set journal.state='rolled_back' before calling escalate so its restore branch is skipped; escalate should then only flip state to 'escalated' and persist.
  - Test: Spy on deps.reload/restoreSnapshot in the existing 'escalates after 2 cycles' index test and assert reload is called once per cycle, not twice on the capping cycle.
- **[u117-2 · review/medium/confirmed]** awaitInput inside a nested workflow corrupts the resume path and strands the inner checkpoint
  - Files: `packages/plugin-workflows/src/executor/dag.ts` (L581-611, 403-485)
  - Fix: Either (a) explicitly reject awaitInput inside a nested workflow at runtime (mirror the loop-body guard at 742-751) — fail loudly rather than half-resume; or (b) properly chain: have runNestedWorkflow surface the inner `runId`, and have resumeWorkflowRun detect a workflow-typed pending step and delegate to a nested resume, then continue the parent DAG. Option (a) is the minimal correct fix and matches the schema's awaitInput-on-prompt/skill-only intent.
  - Test: Build an outer workflow whose step calls a nested workflow containing an awaitInput step; assert the run either rejects cleanly OR resumes the nested DAG to completion AND leaves zero orphaned checkpoint files in the store dir.
- **[u117-3 · consistency/low/unverified-lowrisk]** onError:'retry' is behaviorally identical to 'fail'; retries fire regardless of onError mode
  - Files: `packages/plugin-workflows/src/executor/dag.ts` (L511-532, 356, 760)
  - Fix: Make the contract explicit: either gate retries on `step.onError === 'retry'` (so 'fail'/'continue' run exactly one attempt and 'retry' uses the count), or document that retries is orthogonal and drop the redundant 'retry' enum member (keeping it only as a UI affordance). Aligning the executor with the three-valued enum removes the surprise.
  - Test: Add a test asserting onError:'fail' + retries:2 runs exactly the intended number of attempts under the chosen contract (1 if gated, 3 if orthogonal-and-documented).
- **[u117-4 · review/low/unverified-lowrisk]** A hard step failure does not break the current wave; later wave steps still run and emit completed events
  - Files: `packages/plugin-workflows/src/executor/dag.ts` (L291-361)
  - Fix: Add `if (aborted) break;` after the failure branch (or check `aborted` at the top of the wave for-loop) so a hard failure stops scheduling the rest of the wave. Keep onError:'continue' failures non-breaking.
  - Test: Wave of 2 independent steps where the first fails onError:'fail'; assert the second never runs (not in order[]) and no completed event is emitted for it.
- **[u117-6 · consistency/low/unverified-lowrisk]** Resume re-emits workflow_started with the full step count mid-run
  - Files: `packages/plugin-workflows/src/executor/dag.ts` (L447, 209-212, 484)
  - Fix: Parameterize runExecutorLoop with a `resumed` flag (or split the initial `workflow_started` emit out of the loop body so resume drives the loop without re-emitting start). Emit `workflow_started` only on a fresh run.
  - Test: Resume a paused run with an emit spy; assert exactly one `workflow_started` across the whole run lifecycle and that `workflow_resumed` precedes continued step events.

### [t2-moxxy-home-paths] Route all home-path / proto-constant derivations through the shared helpers

- **Lens:** consistency | **Risk:** low | **Effort:** M | **Findings merged:** 4
- **Packages:** packages/cli, packages/client-platform-web, packages/plugin-view

**What / why:** bin.ts and cli/update/check.ts re-derive the moxxy-home path and ignore MOXXY_HOME (the shared moxxyHome/moxxyPath exists); the MOXXY_PCM16_24KHZ_MIME proto constant is duplicated across 3 packages; countNodes is byte-identical in plugin-view and core (re-routed via SDK).

**Rationale / risk:** Consistency fixes that also correct a real env-var bug (MOXXY_HOME ignored). Low risk; route through the existing shared helper / SDK constant.

**Affected files & merged findings:**

- **[u26-2 · consistency/medium/unverified-lowrisk]** bin.ts reinvents the moxxy-home path and ignores MOXXY_HOME (shared moxxyHome() helper exists)
  - Files: `packages/cli/src/bin.ts` (L228)
  - Fix: Import `moxxyHome` from `@moxxy/sdk` and call `finalizeStagedCoreUpdate(moxxyHome())`. Apply the same swap in self-update.ts (unit 24) so writer and reader agree under MOXXY_HOME.
  - Test: Set MOXXY_HOME to a temp dir, stage a fake core txn (state=staged_restart) there, run any CLI command, assert the journal flips to committed; assert default ~/.moxxy is untouched.
- **[u29-1 · consistency/medium/unverified]** Update-check cache path hardcodes ~/.moxxy, ignores MOXXY_HOME
  - Files: `packages/cli/src/update/check.ts` (L34-36)
  - Fix: Import moxxyPath from '@moxxy/sdk' and return moxxyPath('update-check.json').
  - Test: Add a test setting process.env.MOXXY_HOME to a tmp dir and asserting refreshCheck/readCachedCheck round-trips the cache under that dir.
- **[u35-2 · consistency/medium/unverified-lowrisk]** Protocol constant MOXXY_PCM16_24KHZ_MIME duplicated across 3 packages instead of sourced from one place
  - Files: `packages/client-platform-web/src/pcm16.ts` (L13-13)
  - Fix: Hoist the constant to the typed public surface (@moxxy/sdk, e.g. alongside transcriber types) and have all three sites import it. SDK has zero internal deps so this is invariant-safe. At minimum, plugin-cli should import the existing export rather than redeclare the literal.
  - Test: After consolidation, a single source-of-truth import; add an assertion test in the transcriber that the constant equals the expected wire value to lock the literal.
- **[u115-1 · consistency/medium/unverified]** countNodes is a byte-identical copy of @moxxy/core's exported countNodes
  - Files: `packages/plugin-view/src/index.ts` (L34-37)
  - Fix: Move the canonical countNodes into @moxxy/sdk next to the ViewNode type it operates on (packages/sdk/src/view-renderer.ts), export it from the SDK barrel, and have BOTH @moxxy/core and @moxxy/plugin-view import it. plugin-view already depends on @moxxy/sdk at runtime, so this removes the duplication without dragging in @moxxy/core, and routes the shared helper through the SDK (invariant 3).
  - Test: Add an SDK unit test for countNodes (text=1, nested element fold); keep plugin-view's present-view.test.ts nodeCount assertion (view>stack>2 text = 6) as a cross-package regression that the shared impl still matches.

### [t2-shared-oauth-helpers] Consolidate duplicated OAuth/compaction/onboarding flow helpers

- **Lens:** consistency | **Risk:** low | **Effort:** M | **Findings merged:** 6
- **Packages:** apps/desktop, packages/plugin-commands, packages/plugin-oauth

**What / why:** oauth_get_token refresh-and-store is duplicated across tools and ensureFreshToken and drops persisted extras (account_id); device-flow abort throws bare Error vs MoxxyError; openai device-flow hand-rolls the authorization_code exchange instead of the shared exchange helper; plugin-commands compactSession reimplements runCompactionIfNeeded; CliStep reinvents useOnboarding().install.

**Rationale / risk:** Helper-reuse consolidation in the auth/compaction paths; medium risk because it touches token persistence, so port tests + add account_id-retention coverage.

**Affected files & merged findings:**

- **[u91-4 · atomicity/medium/unverified-lowrisk]** Refresh-and-store logic duplicated across oauth_get_token and ensureFreshTokens
  - Files: `packages/plugin-oauth/src/tools.ts; packages/plugin-oauth/src/ensure-fresh.ts` (L227-267)
  - Fix: Extract one exported refreshAndStore(profile-or-storedCreds, vault) and have buildOauthGetTokenTool call ensureFreshTokens (or the shared helper) instead of re-implementing. Erases the three divergences in one move.
  - Test: After refactor, the existing ensure-fresh tests plus a new oauth_get_token concurrency test (u91-1) both exercise the single helper.
- **[u91-3 · consistency/medium/unverified-lowrisk]** oauth_get_token refresh drops persisted extras (account_id) — diverges from ensureFreshTokens
  - Files: `packages/plugin-oauth/src/tools.ts` (L256-260)
  - Fix: Unify on a single refreshAndStore helper (shared by ensure-fresh and the tool) that always re-reads, merges, and re-persists extras. At minimum pass stored.extras through in the tool's storeTokenSet call.
  - Test: Store creds with extras={account_id:'x'}, expire, call oauth_get_token; assert oauth/<p>/extras still resolves to account_id after refresh.
- **[u90-1 · consistency/medium/unverified-lowrisk]** Device-flow abort throws bare Error; browser-flow uses MoxxyError(NETWORK_ABORTED)
  - Files: `packages/plugin-oauth/src/oauth/poll-until.ts` (L45-67)
  - Fix: Throw MoxxyError with code 'NETWORK_ABORTED' on abort and 'OAUTH_FLOW_TIMEOUT' on deadline, mirroring callback-server.ts; include label/timeout in context. The sleep() helper can reject with the same typed error or a sentinel the loop re-wraps.
  - Test: Unit test pollUntil with an already-aborted signal asserts the rejection is a MoxxyError with code NETWORK_ABORTED; with timeoutMs:1 and a never-resolving fn asserts code OAUTH_FLOW_TIMEOUT.
- **[u89-1 · consistency/medium/unverified-lowrisk]** openai poll() hand-rolls authorization_code exchange instead of shared exchangeCodeForToken
  - Files: `packages/plugin-oauth/src/adapters/openai-device-flow.ts` (L117-143)
  - Fix: Replace lines 117-143 with `return { done: await exchangeCodeForToken({ tokenUrl: opts.tokenUrl, code: data.authorization_code, redirectUri: exchangeRedirectUri, clientId, codeVerifier: data.code_verifier }) };` and import exchangeCodeForToken from ../oauth/token-exchange.js. Drop the now-dead local error/parse block.
  - Test: Existing profile.test.ts openai poll() test asserts the exchange request body fields and the parsed token; keep it green after the swap (the helper produces the same request and parseTokenResponse output). Add a case asserting a non-ok exchange throws a classified MoxxyError.
- **[u80-2 · consistency/medium/unverified-lowrisk]** compactSession reimplements the shared runCompactionIfNeeded compaction flow instead of reusing it
  - Files: `packages/plugin-commands/src/index.ts` (L144-203)
  - Fix: Replace the body with a call into a shared SDK entry point (extend runCompactionIfNeeded or add a thin manual-compact wrapper) that takes the Session's compactor/log/provider and the force semantics, returning saved-count + tokensSaved so the plugin only formats the message. Drop resolveActiveContextWindow in favor of resolveModelContext.
  - Test: Move the existing /compact test to exercise the shared helper; keep a plugin-level test asserting the formatted message only.
- **[u9-2 · consistency/medium/unverified-lowrisk]** CliStep reinvents useOnboarding().install instead of reusing the shared controller
  - Files: `apps/desktop/src/onboarding/steps/CliStep.tsx` (L25-60)
  - Fix: Make CliStep consume the lifted useOnboarding().install controller (status.cliInstalled, install.running/progress/error, install.run) — mirroring how NodeStep uses installNode — instead of its own state + subscription. Drop the duplicated buffer/subscription.
  - Test: After refactor, assert CliStep triggers ob.install.run on click and reflects ob.install.progress; remove the now-dead local subscription. Snapshot the present/installing/failed states.

### [t2-security-correctness-2] Fix the second batch of confirmed security/boundary defects

- **Lens:** review | **Risk:** medium | **Effort:** M | **Findings merged:** 8
- **Packages:** packages/core, packages/desktop-host, packages/isolator-wasm, packages/plugin-cli, packages/plugin-security

**What / why:** broker fs ops are symlink/TOCTOU-permeable (pathInScope is lexical only); brokerExec/brokerFetch buffer output unboundedly (memory DoS); permission inputMatches regex is unanchored (allow rules over-match); wrapDeclaredTools is non-idempotent (re-running onInit double-wraps); workspace.readFile lacks the boundary Zod schema its sibling has; broker fs_write_file swallows the error message; inproc isolator timeout never aborts the handler; clipboard-image require(node:fs) throws at runtime in the ESM-only package on Linux.

**Rationale / risk:** Real confirmed trust-boundary defects from the sweep; each ships with a regression test. Medium risk by virtue of the security surface.

**Affected files & merged findings:**

- **[u105-4 · review/medium/unverified-lowrisk]** Broker fs ops are symlink/TOCTOU-permeable — pathInScope is lexical only
  - Files: `packages/plugin-security/src/broker.ts; packages/plugin-security/src/cap-check.ts` (L167-241, 256-267)
  - Fix: After scope check, resolve fs.realpath(path) (and re-check the realpath against the globs) before opening, or open with O_NOFOLLOW on the final component and on each dir. Document the residual TOCTOU window. At minimum re-validate the realpath so symlink targets are scope-checked.
  - Test: Create cwd/link -> /etc/hosts, call broker fs.readFile('cwd/link') with fs.read=['$cwd/**']; assert denial. Add a rename-race test if feasible.
- **[u105-3 · review/medium/unverified-lowrisk]** brokerExec/brokerFetch buffer stdout/stderr/body unboundedly — memory DoS
  - Files: `packages/plugin-security/src/broker.ts` (L352-389, 270-287)
  - Fix: Add a max-output byte cap (configurable, default e.g. 8MB) to exec accumulation — kill the child and reject when exceeded; for fetch, read the body via a reader loop honoring a content cap (or check Content-Length). Optionally drive the cap from caps.memMb.
  - Test: Exec a command producing >cap bytes (yes | head -c) and assert the broker rejects with a size-limit error rather than buffering all of it; fetch a large body and assert truncation/error.
- **[u40-2 · review/medium/unverified-lowrisk]** inputMatches regex is unanchored — allow rules over-match, granting broader permission than intended
  - Files: `packages/core/src/permissions/engine.ts` (L143-148)
  - Fix: Document and enforce a single anchoring convention. Recommended: treat inputMatches values as full-match by wrapping `^(?:...)$` (consistent with nameMatches), or at minimum document that values are unanchored substring regexes so rule authors anchor deliberately. Add tests covering a substring pattern to lock the chosen semantics.
  - Test: Test that `inputMatches: { path: 'config' }` does NOT allow `/etc/config-evil` under the chosen anchoring (or that it does, deliberately) — pin the decision with an explicit assertion.
- **[u105-2 · review/medium/unverified-lowrisk]** wrapDeclaredTools is NOT idempotent — re-running onInit double-wraps every tool
  - Files: `packages/plugin-security/src/index.ts` (L112-129, 204-233)
  - Fix: Mark wrapped tools (e.g. a non-enumerable __securityWrapped symbol or a WeakSet of wrapped ToolDefs / original handlers) and skip already-wrapped tools in wrapDeclaredTools; or unwrap-then-wrap from a stored original. Add a guard `if (isWrapped(t)) continue;`.
  - Test: Call handle.plugin.hooks.onInit twice, then invoke a wrapped tool that exceeds timeMs; assert exactly one isolation layer (single timeout error, single cap-check), and that a fs.read tool runs its handler once.
- **[u55-1 · review/medium/unverified-lowrisk]** workspace.readFile lacks the boundary Zod schema its sibling listDir has
  - Files: `packages/desktop-host/src/ipc/workspace-fs.ts` (L37-41)
  - Fix: Add `'workspace.readFile': z.object({ workspaceId: z.string().min(1).max(256), path: z.string().max(4096) })` to ipcInputSchemas in desktop-ipc-contract/src/validation.ts, mirroring workspace.listDir (path required since readFile has no sensible default).
  - Test: Unit test asserting validateIpcInput('workspace.readFile', { workspaceId: 'x'.repeat(300) }) throws, and a valid payload passes; plus a contract test that every command whose handler imports node:fs has a schema entry.
- **[u63-5 · review/medium/unverified-lowrisk]** broker_fs_write_file swallows the error message; wasm caller gets bare code 1 with no diagnostic, unlike every other bridge
  - Files: `packages/isolator-wasm/src/index.ts` (L265-281)
  - Fix: Extend broker_fs_write_file's ABI to 6 args (pathPtr,pathLen,dataPtr,dataLen,outPtrOut,outLenOut) like broker_exec, and emit sendErr(outPtrOut,outLenOut, reason) on both cap-deny and the caught IO error, so the failure contract matches the read-side bridges.
  - Test: Add a broker-bridges test asserting an out-of-scope write returns 1 AND writes a 'fs.write capability' message to the out-pointers, mirroring the existing read-deny test.
- **[u104-1 · review/medium/unverified]** inproc timeout rejects but never aborts the handler — runaway work leaks past the budget
  - Files: `packages/plugin-security/src/isolators/inproc.ts` (L41-62)
  - Fix: Create an internal AbortController inside inprocIsolator.run, forward the incoming external signal to it (link abort), and pass the derived controller's signal to the handler instead of the raw external signal; on timeout call controller.abort(reason) BEFORE reject so the handler's in-flight fs/net/exec is actually cancelled. Requires threading a handler-facing signal through wrapWithIsolator (bind ctx with the derived signal) rather than reusing ctx.signal directly. Update both doc-comments to match whatever behavior ships.
  - Test: Add a test where the handler awaits a never-resolving promise but checks its signal.aborted: pass timeMs:20, give the handler a signal-aware body, assert the run rejects with 'exceeded budget' AND the handler observed an abort within the budget window. Currently impossible because the handler shares the un-aborted external signal.
- **[u77-1 · review/medium/unverified-lowrisk]** require('node:fs') in an ESM-only package throws at runtime on the Linux clipboard path
  - Files: `packages/plugin-cli/src/clipboard-image.ts` (L108-109)
  - Fix: Add `writeFileSync` to the top-level `import { mkdirSync, statSync, unlinkSync } from 'node:fs'` and drop the inline `require`. Then `writeFileSync(target, result.stdout)` directly.
  - Test: Unit test readClipboardImageLinux with a spawnSync stub returning a non-empty Buffer on stdout and assert it writes a file + returns a DetectedImagePath (instead of throwing). A bundle smoke test on Linux would also catch the ReferenceError.

### [t2-more-logic-bugs] Fix the second batch of confirmed correctness bugs

- **Lens:** review | **Risk:** medium | **Effort:** M | **Findings merged:** 29
- **Packages:** apps/desktop, apps/fixture-recorder, packages/cli, packages/client-core, packages/client-platform-web, packages/config, packages/core, packages/desktop-host, packages/desktop-ui, packages/isolator-wasm, packages/plugin-channel-http, packages/plugin-cli, packages/plugin-mcp, packages/plugin-oauth, packages/plugin-provider-google, packages/plugin-provider-zai, packages/plugin-telegram, packages/plugin-workflows, packages/runner, packages/sdk, packages/workflows-builder

**What / why:** workflows-builder connectNeeds cycle guard ignores branch/loop edges; command readLastRun substring match resolves the wrong workflow; mic stream leaks if MediaRecorder ctor throws; OAuthSignIn captures onSignedIn at mount; SkillRegistryImpl.replace leaks a stale byName index entry; config_get collapses falsy values to null; HTTP channel error events after listen are swallowed; telegram FramePump/voice-handler raw-length splits and un-awaited savePreferences; PermissionEditor un-guarded concurrent RMW; connectUnixSocket never times out; mcp_add_server registers before persisting; codex stager only scans first 30 releases; gemini/zai capability mis-gating; isolator-wasm broker error laundering; fixture-recorder parseFlags bug; NodeInspector un-editable Args textarea; device-flow unguarded parseInt; HTTP non-streaming turn never aborts on disconnect; Modal focus-trap missing; Skeleton couples to app-only CSS vars; PluginRegisteredEvent.kind union drift; estimateContextTokens over/under-counts.

**Rationale / risk:** A second batch of independently confirmed correctness bugs without a shared structural theme; each gets a targeted fix + regression test. Medium risk spread across many packages.

**Affected files & merged findings:**

- **[u129-3 · review/medium/unverified-lowrisk]** connectNeeds cycle guard ignores branch/loop-body edges, so it can author a cycle the engine rejects
  - Files: `packages/workflows-builder/src/operations.ts` (L157-170, 178-193)
  - Fix: Either narrow the docstring claim (server is the authority) or extend the reachability walk to include branch/loop-body successor edges when computing transitive dependency. Separately gate needs:[loop] additions through the loop-exit/body ops.
  - Test: Build gate(then->b), b(needs->gate via connectNeeds) and assert the cycle is refused; cross-check against server validateDraft.
- **[u118-1 · review/medium/unverified-lowrisk]** readLastRun substring match `-${name}-` resolves the wrong workflow's last run
  - Files: `packages/plugin-workflows/src/command.ts; packages/plugin-workflows/src/engine.ts` (L220-221)
  - Fix: Encode the workflow name unambiguously in the run filename and match exactly. E.g. write records into a per-workflow subdir (`dir/<name>/<stamp>-<ulid>.jsonl`) and have readLastRun list that subdir; or include a stable separator the slug cannot contain and parse the name field out of the first JSONL `run` line rather than the filename. Then match on the parsed `workflow` field.
  - Test: Unit test: write run records for `report` and `daily-report`, call readLastRun('report'), assert the returned head corresponds to the `report` run, not `daily-report`.
- **[u35-1 · review/medium/unverified-lowrisk]** Mic stream leaks if MediaRecorder ctor throws after getUserMedia resolves
  - Files: `packages/client-platform-web/src/audio-capture.ts` (L31-68)
  - Fix: Wrap everything after getUserMedia in try/catch; on any synchronous failure call `stream.getTracks().forEach((t) => t.stop())` (and `audioCtx?.close()`) before rethrowing. Equivalently, factor a `teardown()` that stops tracks + closes the context and call it from both the 'stop' handler and the failure path.
  - Test: Unit test with a mocked getUserMedia returning a fake stream whose getTracks/stop are spies, and a MediaRecorder stub whose constructor throws; assert start() rejects AND every track's stop() was called.
- **[u12-1 · review/medium/unverified-lowrisk]** OAuthSignIn captures onSignedIn at mount via []-dep effect; callers pass an unstable inline closure
  - Files: `apps/desktop/src/settings/shared/OAuthSignIn.tsx` (L48-74)
  - Fix: Store onSignedIn in a ref updated every render (`const cb = useRef(onSignedIn); cb.current = onSignedIn;`) and call `cb.current?.()` inside the handler; keep the []-dep subscription. This removes the stale-closure footgun without re-subscribing per render.
  - Test: Unit test: mount OAuthSignIn with onSignedIn=v1, rerender with onSignedIn=v2, emit provider.login.done code=0 for the active loginId, assert v2 fired (currently v1 would).
- **[u42-1 · review/medium/unverified-lowrisk]** SkillRegistryImpl.replace leaks stale byName index entry when frontmatter.name changes
  - Files: `packages/core/src/registries/skills.ts` (L41-44)
  - Fix: In replace(), read the prior skill first and drop its name from byNameIdx if the name differs: `const prior = this.byId.get(skill.id); if (prior && prior.frontmatter.name !== skill.frontmatter.name) this.byNameIdx.delete(prior.frontmatter.name);` before the two set() calls. Mirror the alias-cleanup pattern already used in CommandRegistry.replace.
  - Test: Unit test: register skill id=X name=foo; replace with id=X name=bar; assert byName('foo') === undefined and byName('bar') is the new skill and list().length === 1.
- **[u38-1 · review/medium/unverified-lowrisk]** config_get collapses legitimate falsy values (false/0/"") to null
  - Files: `packages/config/src/plugin.ts` (L128-141)
  - Fix: Return `cursor === undefined ? null : cursor` at line 140; keep the mid-walk guard but only bail when the intermediate container is null/undefined (it already does). Distinguish missing vs falsy explicitly.
  - Test: Add plugin test: write a yaml with `context:\n  caching: false` and assert config_get('context.caching') === false (not null); same for 0 and "".
- **[u70-2 · review/medium/unverified-lowrisk]** Server 'error' events after listen are swallowed; running promise never rejects on failure
  - Files: `packages/plugin-channel-http/src/channel.ts` (L90-119)
  - Fix: Detach the listen-scoped error listener inside the listen callback, then attach a persistent error handler that logs via this.logger?.warn and rejects the `running` promise (make running a Promise that can reject).
  - Test: Unit test: start the channel, emit a synthetic 'error' on the underlying server, assert logger.warn was called and handle.running rejects.
- **[u110-3 · review/medium/unverified-lowrisk]** FramePump.flush splits parse_mode=HTML on raw length, can sever a tag/entity across messages
  - Files: `packages/plugin-telegram/src/channel/frame-pump.ts` (L76-105)
  - Fix: Split at the HTML structural boundary instead of raw length: break only between top-level composeFrame parts (activity/body/diff/error already joined by '\n\n') and, for an oversized single block, close-and-reopen the surrounding <pre><code>/<blockquote> across the cut. Alternatively compose+split per logical block so a fence is never bisected.
  - Test: Unit-test flush with a body that forces overflow inside a <pre><code> fence; assert every emitted part is well-formed HTML (balanced tags) and no stripHtml fallback fires.
- **[u110-5 · review/medium/unverified-lowrisk]** handleModel persists preferences via un-awaited void savePreferences — failure is silently swallowed
  - Files: `packages/plugin-telegram/src/channel/callback-handler.ts` (L146-209)
  - Fix: await savePreferences inside the existing try block (it already catches and reports via answerCallbackQuery), or at minimum attach a .catch that logs and downgrades the success message. Apply to both handleModel and handleMode.
  - Test: Test handleModel with a savePreferences stub that rejects; assert the user is not told '✓ switched' (or an error toast surfaces) and no unhandled rejection escapes.
- **[u110-1 · review/medium/unverified-lowrisk]** Voice handler drops awaiting-approval-text capture — voice follow-up to approval is lost
  - Files: `packages/plugin-telegram/src/channel/voice-handler.ts` (L61-129)
  - Fix: After the authorization gate and before the busy guard, mirror text-handler: if state.awaitingApprovalText is set, transcribe the audio first, then call approvalResolver.resolvePendingWithText(approvalId, optionId, transcript) and return — or, if voice-as-approval-text is intentionally unsupported, drop the field from VoiceHandlerState to remove the dead plumbing.
  - Test: Add a voice-handler test: set awaitingApprovalText, send a voice note, assert resolvePendingWithText is called with the transcript and the busy reply is NOT sent.
- **[u74-6 · review/medium/unverified-lowrisk]** PermissionEditor fires async engine read-modify-write ops with no in-flight guard or error handling
  - Files: `packages/plugin-cli/src/components/PermissionEditor.tsx` (L44-156)
  - Fix: Add a `.catch` that surfaces the failure via setMode({kind:'message', text:'error: ...'}); gate input with an `applying` flag set true before the op and cleared in finally so concurrent mutations can't interleave.
  - Test: Mock PermissionEngine.addAllow to reject; assert an error message renders and dirty/status is not set to saved. Mock a slow write and fire two flips; assert the second is ignored until the first settles.
- **[u121-1 · review/medium/unverified-lowrisk]** connectUnixSocket never resolves/rejects on a hung connect (no timeout)
  - Files: `packages/runner/src/unix-socket.ts` (L170-183)
  - Fix: Add a bounded connect timeout: `socket.setTimeout(ms)` (or a setTimeout race) that on fire calls `socket.destroy(new Error('connect timeout'))` and rejects, mirroring the explicit lifecycle other callers (isRunnerUp) already give probe sockets.
  - Test: Bind a unix server that accepts the TCP-level connect but a fake transport that never completes, or stub net.connect to emit neither event; assert connectUnixSocket rejects within the timeout instead of hanging.
- **[u85-2 · review/medium/unverified-lowrisk]** mcp_add_server registers live tools before persisting; a persist-race throw leaves orphaned registered tools
  - Files: `packages/plugin-mcp/src/admin/tools/add.ts; packages/plugin-mcp/src/admin/runtime.ts` (Ladd.ts:50-68)
  - Fix: On a persist-time duplicate (or any mutateMcpConfig rejection) after attach, call detachServer(server.name) before rethrowing so the live registry + open client are rolled back to match the unpersisted state.
  - Test: Unit test buildAddServerTool with an attachServer that succeeds + a pre-seeded config containing the same name written between the initial read and the mutate (simulate via a readMcpConfig that returns empty first then populated); assert detachServer was invoked and registry has no orphan tool.
- **[u52-1 · review/medium/unverified-lowrisk]** resolveDesktopRelease only scans the first 30 releases — desktop-v* can be buried by npm cuts
  - Files: `packages/desktop-host/src/app-update/stager.ts` (L103-153)
  - Fix: Either raise to `per_page=100` (cheap, covers far more headroom) and/or follow the `Link: rel="next"` header until a desktop-v* candidate newer than currentVersion is found or pages are exhausted (bounded, e.g. max 3 pages). Pass currentVersion in so paging can stop early once a newer desktop tag is seen.
  - Test: Unit test with a fetchImpl returning a first page of 30 non-desktop releases plus a Link:next header, second page containing the desktop-v release; assert checkForUpdate discovers it (available:true).
- **[u96-1 · consistency/medium/unverified]** Gemini catalog mis-gates capabilities: only one model gets supportsDocuments, none get supportsReasoning
  - Files: `packages/plugin-provider-google/src/models.ts` (L13-22)
  - Fix: Add `supportsDocuments: true` to all five Gemini entries (all 2.5/3 models accept native PDF), and add `supportsReasoning: true` to the reasoning-capable entries (gemini-3-pro/flash, gemini-2.5-pro/flash; verify flash-lite). Mirror the per-model flag completeness used in the OpenAI/Anthropic catalogs.
  - Test: Extend index.test.ts to assert each Gemini descriptor that the header claims is multimodal has supportsImages && supportsDocuments, and that the reasoning-tier models have supportsReasoning — a table-driven expect over geminiModels guards against future drift.
- **[u102-1 · review/medium/unverified-lowrisk]** No GLM model advertises supportsReasoning, so GLM reasoning is never requested/surfaced
  - Files: `packages/plugin-provider-zai/src/models.ts` (L16-32)
  - Fix: Add `supportsReasoning: true` to the GLM-5 family (glm-5.2/5.1/5) and glm-4.6 (and 4.5 tier if z.ai streams reasoning_content for them) in glmModels, matching what the OpenAIProvider already plumbs.
  - Test: Unit test: assert glmModels.find(m=>m.id==='glm-4.6').supportsReasoning === true; integration-style test that a request through zaiProviderDef.createClient with reasoning enabled forwards reasoning_effort and yields reasoning_delta events from a fake GLM stream.
- **[u18-1 · review/medium/unverified]** parseFlags swallows the next token as a value even when it is another flag
  - Files: `apps/fixture-recorder/src/index.ts` (L115-129)
  - Fix: Add a small `takeValue(name)` helper that peeks `argv[i+1]`, throws `"--name requires a value"` when it is missing or starts with `-`, then advances i. Reuse it for every value-bearing flag.
  - Test: Unit test parseFlags: assert `--prompt --name x` throws a value-required error rather than mis-parsing; assert trailing `--prompt` throws; assert a well-formed argv parses to the expected Flags.
- **[u15-3 · review/medium/unverified-lowrisk]** Args (JSON) textarea is un-editable: value re-derived from parsed args, reverts on invalid keystroke
  - Files: `apps/desktop/src/workflows/NodeInspector.tsx` (L218-231)
  - Fix: Keep a local `useState` draft string seeded from the node's args; render the draft, parse on change, and only dispatch update-node when parse succeeds (show an inline 'invalid JSON' hint otherwise). Re-seed the draft when node.id changes.
  - Test: RTL test: type a multi-step edit that passes through an invalid intermediate state and assert the final valid JSON commits and the field retained intermediate keystrokes.
- **[u89-2 · review/medium/unverified-lowrisk]** Unguarded parseInt on interval/expires_in can poison pollUntil timing (NaN)
  - Files: `packages/plugin-oauth/src/adapters/openai-device-flow.ts` (L80-92)
  - Fix: Coerce then validate: `const n = typeof data.interval==='string'?parseInt(data.interval,10):data.interval; const intervalSec = Math.max(Number.isFinite(n)? (n as number):5, 1);` and the same Number.isFinite fallback for expiresInSec (default 600).
  - Test: Unit test: start() given `{interval:'',expires_in:'oops'}` should return intervalMs=5000 and expiresInMs=600000 (or chosen defaults), never NaN.
- **[u70-1 · review/medium/unverified-lowrisk]** Non-streaming /v1/turn and /v1/turn/audio never abort the turn on client disconnect
  - Files: `packages/plugin-channel-http/src/router.ts` (L85-101,180-196)
  - Fix: Extract a shared helper that, for all three handlers, installs an AbortController bound to res 'close' and passes signal into runTurn; the buffered handlers can abandon collection once aborted. Removing the listener in a finally as the stream handler does.
  - Test: Integration test: POST /v1/turn against a FakeProvider whose generator yields slowly, abort the fetch mid-turn, assert the session's turn signal was aborted (spy on runTurn opts.signal.aborted).
- **[u60-2 · review/medium/unverified]** Modal declares aria-modal but never manages focus (no initial focus, no trap, no restore)
  - Files: `packages/desktop-ui/src/Modal.tsx` (L28-92, 104-128)
  - Fix: On mount, save document.activeElement, focus the dialog container (tabIndex=-1 ref) or its first focusable child, and on unmount restore focus to the saved element. Add a Tab/Shift-Tab handler that cycles within the dialog's focusable elements. Optionally trap with inert/aria-hidden on the app root while open.
  - Test: RTL test: render Modal, assert focus lands inside the dialog on open, Tab from last focusable wraps to first, and on unmount focus returns to the trigger.
- **[u60-1 · consistency/medium/unverified]** Skeleton couples to app-only alias CSS vars, not the canonical design-tokens
  - Files: `packages/desktop-ui/src/Skeleton.tsx` (L11-18, 54-66)
  - Fix: Switch Skeleton to the canonical tokens this package's siblings already use: --color-card-bg / --color-card-border (and a real hover/lift token from design-tokens) for background+border, --radius-block is fine (it IS emitted by css-vars.ts:54). This makes the primitive self-contained on @moxxy/design-tokens with no dependency on the desktop's styles.css alias layer.
  - Test: Add a design-tokens parity assertion (or a unit test) that every CSS var referenced by desktop-ui primitives is present in @moxxy/design-tokens' css-vars output; would have flagged the three missing aliases at build time.
- **[u123-1 · consistency/medium/unverified-lowrisk]** PluginRegisteredEvent.kind union is out of sync with PluginKind despite 'keep in sync' note
  - Files: `packages/sdk/src/events.ts; packages/sdk/src/plugin.ts` (L137-155)
  - Fix: Replace the inlined literal union with `ReadonlyArray<PluginKind>` typed structurally — since the cycle concern is only about a *value* import, define a shared `type PluginKindName = ...` in a leaf module (e.g. ids.ts or a new kinds.ts) that both events.ts and plugin.ts import as a pure type, so the list has one source of truth and the cycle stays type-only (dep-cruiser ignores type-only edges). At minimum, add the 5 missing members.
  - Test: Add a type-level test (sdk/src/types.test-d.ts) asserting `PluginRegisteredEvent['kind'][number] extends PluginKind` and vice-versa, so future PluginKind additions fail the build until events.ts is updated.
- **[u122-1 · consistency/medium/unverified-lowrisk]** estimateContextTokens over-counts ToolDisplayResult outputs (skips toolResultBytes)
  - Files: `packages/sdk/src/compactor-helpers.ts` (L77-80)
  - Fix: In eventChars's tool_result branch, reuse the shared helper: replace the non-error path with `return toolResultBytes(e.output)` (import it from elision-state.js, already imported at top of compactor-helpers.ts). This collapses the string/JSON/display cases into the single source of truth and keeps estimate == projection.
  - Test: Add a token-efficiency test: a recent tool_result whose output is a ToolDisplayResult with a large `display` but tiny `forModel`; assert estimateContextTokens counts ~forModel.length/4, not the stringified display. Assert it equals the projected-message char count from projectMessagesFromLog for the same log.
- **[u63-3 · completion/medium/unverified-lowrisk]** Feature is a skeleton: no wasm authoring path / no module actually imports the brokers; bridges only tested in isolation
  - Files: `packages/isolator-wasm/src/index.ts` (L70-76, 1-76)
  - Fix: Either (a) land one real wasm handler fixture that declares the broker imports and exercise it end-to-end in a test, closing u63-2 in the process, or (b) gate wasmIsolator behind an explicit experimental flag / drop the broker imports until a real adopter exists, so users can't select an unverified isolator. Update the stale package.json description once the convention is final.
  - Test: Add an end-to-end test instantiating a real wasm module that imports broker_fs_read_file and reads an in-scope file, asserting the bytes round-trip through linear memory.
- **[u118-2 · completion/medium/unverified-lowrisk]** `/workflows run` mishandles a paused (awaitInput) run — reports it as completed
  - Files: `packages/plugin-workflows/src/command.ts` (L126-129)
  - Fix: Branch on `result.status`: when `paused`, print a distinct message naming the pending step and its prompt, and how to resume (the workflow.resume RPC / reply UI). Only print the completed/failed heads for terminal statuses.
  - Test: Inject a `runNow` that returns a paused WorkflowRunResult; assert runCmd output mentions 'paused'/'awaiting input' and the pending step id, not 'completed'.
- **[u33-1 · review/medium/unverified-lowrisk]** useOnboarding.refresh has no catch — mount-path rejection becomes unhandled
  - Files: `packages/client-core/src/useOnboarding.ts` (L60-78)
  - Fix: Wrap the Promise.all body in a catch that records an error (or at minimum swallows it like usePrefs/useMobileGateway do on their mount fetch) so the auto-refresh path can't produce an unhandled rejection; consider settling each probe independently so one failing probe doesn't blank both status and node.
  - Test: renderHook(useOnboarding) with a transport whose onboarding.status rejects; assert no unhandled rejection and that loading flips to false.
- **[u28-1 · review/medium/unverified-lowrisk]** fileChanged watchers only built once in onReady; runtime save/enable never re-registers them
  - Files: `packages/cli/src/setup/workflows.ts` (L362-427)
  - Fix: Call startFileWatchers() (or fold it into syncSchedules) after every store mutation, e.g. append `await startFileWatchers()` inside syncSchedules (after the schedule loop) or invoke both from save/setEnabled. Guard against re-entrancy if syncSchedules is hot.
  - Test: Integration test: boot integration, save a workflow with on.fileChanged at runtime, touch a matching file, assert runNow fired (spy on runNow). Currently it would not.
- **[u90-2 · test-gap/medium/unverified-lowrisk]** RFC 8628 error branches (access_denied/expired_token/generic) of classifyDeviceTokenResponse untested
  - Files: `packages/plugin-oauth/src/oauth/device-flow-shared.ts` (L86-120)
  - Fix: Add a direct unit test on classifyDeviceTokenResponse covering each error string → expected MoxxyError code; assert slow_down increments state.intervalMs by exactly 5000 and returns pending; assert ok+access_token returns {done}.
  - Test: Pure-function tests; no fetch mocking needed (pass synthetic {ok,status} + json + state).

---

## Tier 3 — large / architectural / propose-only

### [t3-god-files] Decompose the god-files / god-functions into single-responsibility units

- **Lens:** review | **Risk:** medium | **Effort:** XL | **Findings merged:** 19
- **Packages:** apps/desktop, packages/cli, packages/core, packages/desktop-ipc-contract, packages/plugin-self-update, packages/plugin-webhooks, packages/plugin-workflows, packages/runner, packages/sdk

**What / why:** RemoteSession (600-line, 11 client-view facades), RunnerServer (~40 handleX across 6 domains), sdk/mode-helpers.ts (797 lines, 5 concerns), DAG executor (883 lines), desktop electron main index.ts (1054 lines), WorkflowCanvas (1330-line file), Composer (443 lines/24 hooks), desktop-ipc-contract (1129-line barrel), and the inline tool-factory god-functions (coreTools 229, buildWebhookTools 344, buildBuiltinsCore 425, buildWorkflowsIntegration 375, createWindow 346). Also PluginHost.unload hardcodes 17 unregister calls. Co-locate each surface client-view with its server handler to stop drift.

**Rationale / risk:** High-value maintainability but large, cross-cutting, behavior-sensitive splits that each merit their own PR + careful test pinning. Propose only; sequence after the Tier-1/2 dead-code and dup removals shrink these files.

**Affected files & merged findings:**

- **[structure-atomicity-1 · review/high/unverified]** RemoteSession god-class: one 600-line class hosts 11 unrelated client-view facades
  - Files: `packages/runner/src/remote-session.ts` (L159-760)
  - Fix: Extract each makeXView into its own module under packages/runner/src/client-views/ (one file per surface, e.g. workflows-view.ts, mcp-admin-view.ts) as a pure factory `(peer: JsonRpcPeer, info: () => SessionInfo) => XClientView`. RemoteSession keeps only transport/turn/attach/resolver logic and calls the factories. Move the facade-local interfaces into their respective files; re-export shared types through @moxxy/sdk (invariant 3).
  - Test: Existing runner protocol/round-trip tests cover behavior; add per-view unit tests that pump a stub JsonRpcPeer. No protocol bump (pure refactor).
- **[structure-atomicity-2 · review/high/unverified]** RunnerServer god-class: ~40 handleX RPC methods for 6 unrelated domains in one class
  - Files: `packages/runner/src/server.ts` (L85-735)
  - Fix: Split into per-domain handler modules (provider-handlers.ts, workflow-handlers.ts, surface-handlers.ts, mcp-handlers.ts, media-handlers.ts) exporting `(ctx: { session, broadcast, ... }) => Record<RunnerMethod, Handler>`; RunnerServer composes the maps into its dispatch table. Keep turn/attach/resolver logic in server.ts. Mirror the same boundaries as the client-view split (#1) so the protocol surface stays legible.
  - Test: Runner protocol integration tests already exercise each RPC; add a dispatch-table assertion that every RunnerMethod has exactly one handler. Pure refactor, no protocol version change.
- **[structure-atomicity-3 · review/high/unverified]** sdk/mode-helpers.ts bundles 5 independent concerns into one 797-line module
  - Files: `packages/sdk/src/mode-helpers.ts` (L1-797)
  - Fix: Split into focused files under packages/sdk/src/mode/ (project-messages.ts, collect-stream.ts, single-shot.ts, stuck-loop.ts, stable-hash.ts) and re-export from mode-helpers.ts as a barrel so existing import sites are unchanged. stableHash is generic and should live in a util module (other callers may want it without dragging in stream/projection code). Preserves invariant 1 (no internal deps added).
  - Test: Existing mode tests + projectMessages/collectProviderStream unit tests gate behavior; barrel keeps API stable so no caller changes needed.
- **[structure-atomicity-4 · review/high/unverified]** DAG executor mixes serialization, scheduling loop, step kinds, and resume in one 883-line file
  - Files: `packages/plugin-workflows/src/executor/dag.ts` (L75-878)
  - Fix: Split into executor/state-serde.ts (serialize/restore/build*), executor/scheduler.ts (runExecutorLoop/runExecutor/resumeWorkflowRun), executor/steps.ts (runStep/runStepOnce/runNestedWorkflow + buildSubagentSpecWithDeps), executor/logic-loop.ts (runLogicStep/runLoopStep/evaluateLoopCondition/buildUpstreamBlock). dag.ts keeps only the defineWorkflowExecutor registration glue. Keep ExecutorContext as the shared seam passed between modules.
  - Test: Workflow executor + resume tests cover the loop; new focused tests for logic-loop.ts (condition eval, loop body skip) and state-serde.ts round-trip. Behavior-preserving.
- **[structure-atomicity-5 · review/medium/unverified]** buildWebhookTools is one 344-line function inlining 11 independent tool definitions
  - Files: `packages/plugin-webhooks/src/tools.ts` (L133-476)
  - Fix: Extract each tool into a small `defineWebhookCreateTool(deps): ToolDef` style factory in tools/ (one file per tool or grouped create/read/mutate/tunnel files); buildWebhookTools becomes a 15-line composition that spreads the factories. Mirrors the already-modular plugin-self-update pattern (xTool() per tool). Use defineX factories (invariant 10).
  - Test: Existing webhook tool tests cover handlers; per-factory unit tests become trivial once isolated. No behavior change.
- **[structure-atomicity-6 · review/medium/unverified]** coreTools() inlines 8 Tier-2 core-update tools in one 229-line function
  - Files: `packages/plugin-self-update/src/index.ts` (L398-626)
  - Fix: Split coreTools into per-tool factories (coreWriteTool, coreEditTool, coreVerifyTool, coreApplyTool, ...) in a core-tools/ subdir, matching the Tier-1 style; coreTools() becomes a thin spread. Improves auditability of the most security-sensitive (core-patching) tools.
  - Test: Existing self-update core tests (the verify-desktop-packaged path is out of scope) plus per-tool unit tests post-split. Behavior-preserving.
- **[structure-atomicity-7 · review/medium/unverified]** createWindow() is a 346-line setup procedure mixing window, CSP, loopback, widget, and menu wiring
  - Files: `apps/desktop/electron/main/index.ts` (L185-530)
  - Fix: Extract create-main-window.ts (window + renderer-load + loopback decision), create-widget-window.ts, and a bootstrap.ts that owns the whenReady sequence; index.ts becomes a thin orchestrator wiring app lifecycle events to those modules. Keep deep-link/menu helpers in their own files.
  - Test: Electron main is integration-tested via verify-desktop-packaged (boot probe). Refactor is structural; the armBootProbe smoke gate guards regressions.
- **[structure-atomicity-8 · review/medium/unverified]** desktop-ipc-contract is a single 1129-line barrel spanning ~12 domain contracts
  - Files: `packages/desktop-ipc-contract/src/index.ts` (L1-1129)
  - Fix: Split into domain files under src/ (connection.ts, settings.ts, desks.ts, chat.ts, surfaces.ts, app-update.ts, mobile.ts) each owning its interfaces and contributing its slice of IpcCommands/IpcEvents via interface-merging or composed unions; index.ts re-exports + assembles the final IpcCommands. Keeps the single public surface while letting each domain be edited atomically. Pure-type package, no runtime risk.
  - Test: Typecheck is the gate (consumers import named types); add a compile-time assertion that REMOTE_ALLOWED_COMMANDS keys are a subset of IpcCommandName. No behavior change.
- **[structure-atomicity-9 · review/medium/unverified]** WorkflowCanvas is a 503-line component (1330-line file) carrying pan/zoom, drag-connect, and layout
  - Files: `apps/desktop/src/workflows/WorkflowCanvas.tsx` (L138-640)
  - Fix: Extract camera/pan-zoom into a useCanvasCamera() hook and drag-to-connect into a useDragConnect() hook (apps/desktop/src/workflows/canvas/); move NodeCard/Edge/Handle/InsertNodeMenu into canvas/ component files. WorkflowCanvas keeps composition + reducer dispatch. This isolates the gesture state machines that are the trickiest part.
  - Test: WorkflowsPanel.test.tsx already covers drag-to-connect (lines 378-561); extracting the hook lets it be unit-tested directly. Component-level behavior unchanged.
- **[structure-atomicity-10 · review/medium/unverified]** buildBuiltinsCore is a 425-line wiring function with inline tool defs and runtime concerns
  - Files: `packages/cli/src/setup/builtins.ts` (L164-588)
  - Fix: Move the inline voice tools into the existing voice plugin (they don't belong in cli/setup); extract the entries[] into a builtin-entries.ts data module and the live-plugin enable/disable closure into plugin-toggle.ts. buildBuiltinsCore becomes orchestration that consumes those. Keeps wiring legible and stops cli/setup from owning model-tool definitions.
  - Test: CLI smoke (run-the-cli) plus setup unit tests; the builtin set is enumerable so add a snapshot of registered plugin/tool names to guard the move.
- **[structure-atomicity-11 · review/medium/unverified]** Composer is a 443-line component with 24 hook sites mixing input, attachments, slash-cmds, and modes
  - Files: `apps/desktop/src/chat/Composer.tsx` (L91-533)
  - Fix: Extract useComposerAttachments() (pick/drop/paste state) and useSlashTrigger() hooks; lift send orchestration into a useComposerSubmit() callback module. Composer keeps layout + wiring. Reduces the hook surface per concern and makes the attachment path independently testable.
  - Test: Desktop renderer tests around composer behavior; extracting hooks enables unit tests for attachment normalization and slash detection. Behavior-preserving.
- **[structure-atomicity-12 · consistency/low/unverified]** Runner client-views and server-handlers drift apart because the two halves of each surface live far apart
  - Files: `packages/runner/src/remote-session.ts; packages/runner/src/server.ts; packages/runner/src/protocol.ts`
  - Fix: After splitting #1 and #2 per-domain, co-locate each surface's three slices under packages/runner/src/surfaces/<name>/ (wire-types.ts, server-handlers.ts, client-view.ts) with a shared RunnerMethod enum slice. A single index assembles them. This makes each surface an atomic unit and a compile-time map enforces handler<->view symmetry.
  - Test: Add a structural test asserting every RunnerMethod has both a server handler and a client-view caller. Existing protocol round-trip tests unchanged.
- **[structure-atomicity-13 · review/low/unverified]** buildWorkflowsIntegration is a single 375-line setup function
  - Files: `packages/cli/src/setup/workflows.ts` (L63-437)
  - Fix: Decompose into smaller composables: register-executor.ts, build-workflow-tools.ts, wire-run-store.ts, each returning a slice the top builder spreads. Keeps the public buildWorkflowsIntegration signature.
  - Test: Workflows setup + tool tests; snapshot the registered tool/executor names to guard the move.
- **[structure-atomicity-14 · review/low/unverified]** PluginHost.unload hardcodes 17 registry.unregister calls — registry list duplicated and fragile
  - Files: `packages/core/src/plugins/host.ts` (L261-310)
  - Fix: Drive registration/unregistration from a single REGISTRY_KINDS table mapping kind -> (plugin field, registry, record-names field). unload/applyPlugin iterate the table so adding a registry is one entry. Removes the duplicated 17-line lists and guarantees register/unregister stay in lockstep.
  - Test: Add a test that registers a plugin contributing to every registry kind, unloads it, and asserts every registry is empty (catches future leaks).
- **[u6-1 · atomicity/medium/unverified-lowrisk]** index.ts is a 1054-line god-file mixing 8+ unrelated main-process concerns
  - Files: `apps/desktop/electron/main/index.ts` (L1-1054)
  - Fix: Extract cohesive units into sibling modules with explicit deps so each is unit-testable: deep-link.ts (parseDeepLink/handleDeepLink/focusMain + the pending buffer), oauth-window.ts (cleanOAuthUserAgent + OAUTH_HOST_PATTERNS builder + setWindowOpenHandler), boot-probe.ts (armBootProbe with injected readConfirmed/markConfirmed/markBad/appendBootLog), loopback-tls.ts (cert verify proc + certificate-error). Keep index.ts as orchestration only.
  - Test: After extraction, unit-test parseDeepLink (valid moxxy://, non-moxxy scheme, malformed), cleanOAuthUserAgent (strips Electron/app tokens, idempotent), and armBootProbe state transitions (confirm-via-DOM, timeout->markBad+relaunch) with a fake webContents.
- **[u15-6 · atomicity/low/unverified-lowrisk]** WorkflowCanvas is a 1300-line god-file mixing transform math, pure graph helpers, and many sub-components
  - Files: `apps/desktop/src/workflows/WorkflowCanvas.tsx` (L1-1331)
  - Fix: Extract the pure graph/geometry helpers into a sibling `canvas-graph.ts` (topoOrder, nodeAt, inBodyRegion, portOrigin, disconnectEdge) and the leaf presentational components (Edge, NodeCard, Handle, ZoomControls, InsertNodeMenu, TempLine) into a `canvas/` folder. Unit-test the extracted helpers.
  - Test: After extraction, add focused unit tests for topoOrder (longest-path layering, cycle fallback) and disconnectEdge (each edge kind routes to the right inverse op).
- **[u28-3 · atomicity/medium/unverified-lowrisk]** buildBuiltinsCore is a ~420-line god-function assembling every builtin plus inline plugin definitions
  - Files: `packages/cli/src/setup/builtins.ts` (L164-588)
  - Fix: Extract voice-admin into its own @moxxy/voice-admin (or plugin-voice-admin) package added to `entries` like the rest; move setPluginEnabledLive + session.pluginsAdmin wiring and the scheduler/webhooks/workflows/security sub-builders into named helper functions (one concern each). Keep buildBuiltinsCore as a thin assembler.
  - Test: After extraction, add a focused unit test for the voice-admin tools (set_voice 'system' clears, unknown name throws) — currently impossible to import without booting the whole builtins assembly.
- **[u106-8 · atomicity/low/unverified-lowrisk]** coreTools() is a ~230-line god-factory mixing 8 tool definitions, journal mutation, and overlay orchestration
  - Files: `packages/plugin-self-update/src/index.ts` (L397-626)
  - Fix: Extract a CoreTxn state-machine module (transition(journal, event) with explicit legal transitions + a single applyTransition that persists) and have thin tool handlers call it; same for Tier-1. This makes the state machine unit-testable and keeps each tool handler single-responsibility.
  - Test: Unit-test the extracted transition function for each legal/illegal transition; tool handlers then just wire schemas.
- **[u123-5 · atomicity/low/unverified-lowrisk]** projectMessages mixes 5 distinct concerns in one ~260-line function
  - Files: `packages/sdk/src/mode-helpers.ts` (L142-404)
  - Fix: Extract pure sub-steps: (a) a `projectUserPrompt(event, el)` returning blocks, (b) an `OrphanResolver` precomputed once, (c) a small reducer object encapsulating pendingAssistant/pendingReasoning with explicit flush() — so each is independently unit-testable. Keep the public signature; this is an internal decomposition.
  - Test: After extraction, unit-test each sub-step (attachment expansion, orphan synthesis, reasoning ordering) directly; keep existing loop-helpers/token-efficiency integration tests as regression guards.

### [t3-test-harness] Build the missing test harnesses for the load-bearing untested subsystems

- **Lens:** test-gap | **Risk:** low | **Effort:** XL | **Findings merged:** 31
- **Packages:** packages/cli, packages/client-core, packages/core, packages/desktop-host, packages/plugin-browser, packages/plugin-self-update, packages/plugin-terminal, packages/plugin-webhooks, packages/runner, packages/sdk

**What / why:** Many critical reducers/folds/parsers/protocol handlers have ZERO co-located tests: the live multi-workspace chatStore (slot reducer/queue/usage fold), SurfaceHostImpl protocol-v8 multiplexer, runner Surface RPC handlers + surface.data broadcast, desktop-host IPC surfaces, git porcelain/diff parser, provider-discovery/onboarding, the dedupe LRU+TTL cache, wizard concurrency, browser-surface polling lifecycle, self-update provenance/source-pin, and ~100 smaller per-unit test-gap findings. Stand up the harnesses as a sustained additive effort.

**Rationale / risk:** Additive (no behavior change) and de-risks every other cluster, but the volume is large and several harnesses are non-trivial (protocol multiplexers, multi-workspace store). Treat as an ongoing track, prioritizing harnesses that unblock Tier-2 refactors (chatStore, registries, stores).

**Affected files & merged findings:**

- **[test-coverage-1 · test-gap/high/unverified]** SurfaceHostImpl (protocol-v8 surface multiplexer) has ZERO co-located test
  - Files: `packages/core/src/surfaces/host.ts` (L27-158)
  - Fix: Add packages/core/src/surfaces/host.test.ts driving SurfaceHostImpl against a fake SurfaceRegistry + a fake SurfaceDef whose open() returns a controllable instance (onData emitter, snapshot(), input/resize/close spies). Assert: (a) open(kind) twice returns the same surfaceId and only calls def.open once; (b) two concurrent open(kind) promises resolve to the same instance and def.open ran once; (c) onData frames fan out to every onData subscriber as SurfaceDataMessage with the right surfaceId/kind; (d) a throwing listener does not suppress delivery to others; (e) close() calls the stored unsub (no frames after close) and instance.close(); (f) closeAll() closes every open instance; (g) input/resize route by surfaceId and no-op on unknown ids.
  - Test: Pure in-memory unit test with fake registry+instance; no real PTY/Playwright needed. ~10 cases.
- **[test-coverage-3 · test-gap/high/unverified]** Live desktop multi-workspace chatStore (slot reducer/queue/usage fold) has NO co-located test
  - Files: `packages/client-core/src/chat-store/store.ts; packages/client-core/src/chat-store/state.ts; packages/client-core/src/chat-store/usage.ts` (Lstore.ts:1-366)
  - Fix: Add chat-store/store.test.ts (and optionally state.test.ts/usage.test.ts). Cover: per-workspace slot isolation (events for ws A never leak into ws B's snapshot); queue enqueue->dequeue ordering + remove-by-id + id uniqueness; hideTurn/unhideTurn affecting buildSnapshot; lastSeenRev/hasUnread + workspacesWithUnread; compacting/autoApprove/model setters bumping rev only on change; buildSnapshot stability across chunk-only ticks (the documented fold memo invariant in state.ts:13,30,120); usage.ts token accounting folded from provider_response.
  - Test: Instantiate the store, feed synthetic MoxxyEvent streams per workspace, assert snapshots/queue/unread; no React render needed.
- **[test-coverage-4 · test-gap/medium/unverified]** git.ts porcelain/diff parsing (files-changed rail) is parse-heavy and untested
  - Files: `packages/desktop-host/src/git.ts` (L76-128)
  - Fix: Add packages/desktop-host/src/git.test.ts running against a real tmp git repo (git init; stage/modify/rename/add-untracked files; a path with a space). Assert status() returns the right {path,status} set including ' M', '??', 'A ', 'R '; diff() returns a unified diff for tracked + the --no-index diff for untracked; the size cap truncates a large diff; isRepo() true/false. Alternatively stub the git() exec to feed canned -z/porcelain output and assert parsing.
  - Test: Real tmp-repo integration test (deterministic, fast) or canned-output unit test for the pure parsers.
- **[test-coverage-5 · test-gap/medium/unverified]** Runner Surface RPC handlers + surface.data broadcast path are absent from the otherwise-thorough runner integration suite
  - Files: `packages/runner/src/server.ts; packages/runner/src/integration.test.ts` (L200-204, 622-647)
  - Fix: Extend runner/src/integration.test.ts: register a fake surface in the test session, then over the real socket call surface.open and assert the returned surfaceId+snapshot; push a frame from the fake instance and assert an attached client receives a surface.data notification carrying that surfaceId/kind/payload; call surface.input/resize/close and assert they reach the instance; assert close stops further surface.data frames. Also assert bad params reject (schema parse).
  - Test: Reuse the existing real-socket harness in integration.test.ts with a fake SurfaceDef registered on the session.
- **[test-coverage-6 · test-gap/medium/unverified]** desktop-host IPC surfaces handler (renderer<->runner surface bridge) untested
  - Files: `packages/desktop-host/src/ipc/surfaces.ts`
  - Fix: Add packages/desktop-host/src/ipc/surfaces.test.ts dispatching each surface IPC command through the contract dispatcher against a fake runner client; assert it forwards to the right RunnerMethod and that runner surface.data notifications are relayed to the renderer event bus with the correct shape. Confirm first whether logic lives here or is a thin pass-through (if purely declarative wiring, downgrade to low).
  - Test: Contract-level unit test with a fake runner peer + a capturing event bus.
- **[test-coverage-7 · test-gap/low/unverified]** desktop-host plugin/provider boot wiring (in-process-plugins, provider-discovery) untested
  - Files: `packages/desktop-host/src/in-process-plugins.ts; packages/desktop-host/src/provider-discovery.ts`
  - Fix: Add focused tests asserting the expected set of plugin/provider names is assembled given a representative config, and that disabledProviders from preferences are honored (registered-but-not-active). Keep it a list/identity assertion, not a full boot.
  - Test: Unit test the assembly function with a fake config; assert the produced plugin/provider name set.
- **[u31-2 · test-gap/medium/unverified-lowrisk]** No unit tests for the usage fold, snapshot-cache builder, prependFresh dedup, or queue/compaction logic
  - Files: `packages/client-core/src/chat-store/usage.ts; packages/client-core/src/chat-store/state.ts; packages/client-core/src/chat-store/store.ts` (Lusage.ts:48-69; state.ts:122-152; store.ts:238-330)
  - Fix: Add chat-store/usage.test.ts and store.test.ts: assert recordUsage returns null when no usage fields, increments calls but not perCall when only outputTokens present, sums totals; assert dispatch(provider_response) updates usage but not the log; assert dispatch(compaction) reduces latestPrompt by tokensSaved and appends a notice; assert buildSnapshot reuses the cached object when rev/hasOlder unchanged and preserves the events array reference across a streaming-only tick.
  - Test: Drive the exported pure functions and the chatStore singleton directly (it is React-free) with synthetic MoxxyEvents.
- **[u33-4 · test-gap/medium/unverified-lowrisk]** Optimistic switch gestures + usage/context math + queue drain untested
  - Files: `packages/client-core/src/useDesks.ts; packages/client-core/src/useContextUsage.ts; packages/client-core/src/useChat.ts` (LuseDesks 116-219; useContextUsage 60-118; useChat 48-94,172-204)
  - Fix: Add hook/store tests: (1) summarize() and resolveContextWindow() as pure-function table tests; (2) DesksStore.setActive/setActiveSession failure paths asserting activeId + connectionStore.active$() roll back; (3) useChat send() queueing while activeTurnId set, and ChatStoreBridge draining the queue on turn_complete.
  - Test: Vitest + a fake api() transport and a stub connectionStore/chatStore; assert state and connectionStore.setActive call order on success and failure.
- **[u48-1 · test-gap/medium/unverified-lowrisk]** SurfaceHostImpl has zero unit tests despite owning idempotent-open, multiplex fan-out and cleanup
  - Files: `packages/core/src/surfaces/host.ts` (L27-158)
  - Fix: Add packages/core/src/surfaces/host.test.ts with a fake SurfaceDef + fake SurfaceInstance covering: (a) open(kind) twice returns same surfaceId and re-snapshots without re-subscribing; (b) two concurrent open(kind) share one instance (assert def.open called once); (c) onData receives multiplexed frames tagged with surfaceId/kind and a throwing listener doesn't break the stream; (d) close() calls unsub then instance.close, removes from instances/unsubs, and swallows a close() rejection; (e) closeAll closes every open instance.
  - Test: Vitest unit suite with stub registry/def/instance and a recording onData; assert call counts and map state via the public surface only.
- **[u48-3 · review/low/unverified-lowrisk]** open() resolves OpenSurfaceResult but never registers the instance in `opening`-failure / no rollback on subscribe path
  - Files: `packages/core/src/surfaces/host.ts` (L67-102)
  - Fix: Wrap the post-open steps in try/catch; on failure call unsub(), delete from instances/unsubs, await instance.close().catch(...), and rethrow — so a failed open leaves no live orphan. Alternatively compute snapshot defensively before mutating maps.
  - Test: Unit test: a fake def whose instance.snapshot() throws; assert open() rejects AND instances/unsubs are empty afterward (no orphan, def.open's instance.close was called).
- **[u56-3 · test-gap/medium/unverified-lowrisk]** git status/diff parser has no unit test despite parsing porcelain + driving the diff pane
  - Files: `packages/desktop-host/src/git.ts` (L85-128)
  - Fix: Add git.test.ts driving the helpers against a real temp git repo (init, add, commit, rename, modify, add untracked) asserting status() rows and diff() output, plus a unit test of the porcelain parser on a captured -z byte string for the rename case.
  - Test: vitest with a tmp repo via spawnSync('git', ...); also a pure parser test on a fixed Buffer.
- **[u56-2 · review/medium/unverified-lowrisk]** git status -z rename parsing emits a phantom ChangedFile for the old path
  - Files: `packages/desktop-host/src/git.ts` (L86-104)
  - Fix: Parse -z records statefully: when an entry's XY starts with 'R' or 'C', consume the NEXT NUL field as the old path (and don't emit it as its own ChangedFile). Use the new path for the rename row.
  - Test: Unit-test the parser against a captured `git status --porcelain=v1 -z` byte string containing a rename (e.g. `R  new\0old\0 M other\0`) and assert exactly two ChangedFile rows (new, other) with no phantom 'ld' entry.
- **[u56-4 · review/low/unverified-lowrisk]** Untracked-file diff uses POSIX /dev/null, breaking the diff pane on Windows
  - Files: `packages/desktop-host/src/git.ts` (L120-127)
  - Fix: Use git's portable empty-tree object as the base (`git diff --no-index` against the NUL device is non-portable); e.g. `git diff -- /dev/null` → instead diff against the empty blob: `git diff --no-index -- <NUL-device-or-empty-temp> <file>` choosing 'NUL' on win32, or better `git diff $(git hash-object -t tree /dev/null) -- <file>` style with the well-known empty-tree sha 4b825dc642cb6eb9a060e54bf8d69288fbee4904.
  - Test: Add a Windows CI leg (or mock platform) asserting an untracked file yields a non-empty unified diff.
- **[u57-1 · review/medium/unverified-lowrisk]** fetchProviderModels has no fetch timeout — IPC handler can hang indefinitely
  - Files: `packages/desktop-host/src/provider-discovery.ts` (L164-180)
  - Fix: Wrap the fetch in an AbortController with a finite deadline (e.g. AbortSignal.timeout(8_000)) and reject with a readable 'provider /v1/models timed out' error; the caller already falls back to runner-advertised models. Add a similar timeout/kill to vaultGet's spawned child.
  - Test: Unit test fetchProviderModels with a mocked fetch that never resolves and a fake AbortSignal.timeout; assert it rejects within the budget. Add a providers.json fixture entry so the non-built-in branch is exercised.
- **[u57-2 · test-gap/medium/unverified-lowrisk]** provider-discovery, onboarding, and prefs have zero unit tests despite parsing/security-gated logic
  - Files: `packages/desktop-host/src/provider-discovery.ts; packages/desktop-host/src/onboarding.ts; packages/desktop-host/src/prefs.ts`
  - Fix: Add unit tests: prefs (defaults merge, malformed JSON → defaults, concurrent updatePrefs serialize without clobber), onboarding (readVaultKeys parses/empties, hasProvider true only when expected key present), provider-discovery (key-name derivation, /v1/models id filtering+sort, built-in returns []). Ideally extract the single `<NAME>_API_KEY` slug helper and test it once.
  - Test: Vitest with tmpdir fixtures for the JSON files and a mocked spawnCli/fetch.
- **[u57-3 · consistency/low/unverified-lowrisk]** `<NAME>_API_KEY` vault-key slug re-derived in 4 places (copy-paste)
  - Files: `packages/desktop-host/src/onboarding.ts; packages/desktop-host/src/provider-discovery.ts` (Lonboarding.ts:28,72; provider-discovery.ts:95,138)
  - Fix: Export one helper (reuse builtinProviderKeyName, or move it next to assertSafeProviderName in security.ts) and call it from all four sites. Single source of truth, one test.
  - Test: Unit test the shared helper for `-`→`_`, upper-casing, suffix.
- **[u68-2 · test-gap/medium/unverified-lowrisk]** browser-surface.ts has zero unit tests — polling lifecycle, fail-grace, input coordinate mapping untested
  - Files: `packages/plugin-browser/src/browser-surface.ts` (L36-116)
  - Fix: Add browser-surface.test.ts driving a fake sidecar (reuse the makeFakeSpawn helper / inject deps.spawnFn): assert (a) first failure does NOT emit status, FAIL_GRACE-th failure with no prior frame DOES; (b) a successful frame resets `fails` and updates snapshot(); (c) close() clears the interval (no further calls) and dataSubs; (d) input click maps fx/fy to vw/vh pixel coords sent to the `mouse` method.
  - Test: Vitest with fake timers (advance past FRAME_INTERVAL_MS) + injected fake sidecar call.
- **[u68-3 · review/low/confirmed]** getSidecar() silently ignores deps on the second+ caller — surface and tool can be wired with mismatched spawnFn
  - Files: `packages/plugin-browser/src/browser-session.ts` (L290-296, 399-414)
  - Fix: Either (a) assert/warn when getSidecar is called with deps that differ from the cached instance's, or (b) make the singleton keyed/scoped (pass the sidecar instance explicitly through plugin construction rather than a module global). Minimum: document that deps are honored ONLY on first spawn and that closeBrowserSidecar() resets it.
  - Test: Unit test: call getSidecar with spawnFnA, then browserSidecarCall with spawnFnB, assert spawnFnB is NOT used (current) — then after fix assert a warning/throw, or that the explicit instance is used.
- **[u68-5 · review/low/unverified-lowrisk]** Surface swallows all frame errors permanently once one frame has succeeded
  - Files: `packages/plugin-browser/src/browser-surface.ts` (L59-66)
  - Fix: Use `>=` and emit a 'frame stale / browser disconnected' status on sustained failure even when a prior frame exists (e.g. after N consecutive fails, regardless of `last`), so a dead page is visible rather than frozen on a stale screenshot.
  - Test: Test: deliver one good frame, then make the fake call reject for >FAIL_GRACE ticks, assert a 'stale/disconnected' status is emitted.
- **[u69-2 · test-gap/medium/unverified-lowrisk]** dispatch.test.ts only covers goto-SSRF; the rest of the protocol handler is untested
  - Files: `packages/plugin-browser/src/sidecar/dispatch.ts` (L92-262)
  - Fix: Add table-driven dispatch tests using makeFakeHandle (extend it with mouse/keyboard/viewportSize stubs) asserting reply shape + that `badParams`-thrown errors surface kind:'runtime', and that an unknown method returns kind:'runtime'.
  - Test: Vitest cases per method against a fake PlaywrightHandle; assert exact Ok/Err shapes.
- **[u69-3 · review/low/unverified-lowrisk]** Surface-only methods (mouse/key/scroll) skip all input validation — undefined coords reach Playwright
  - Files: `packages/plugin-browser/src/sidecar/dispatch.ts` (L185-205)
  - Fix: Add `badParams` guards for `mouse` (require finite x,y) for parity with `key`, or validate surface params with a shared zod schema at the dispatch boundary.
  - Test: Dispatch unit test: send `mouse` with missing x/y and assert an Err with kind:'runtime' rather than an unhandled Playwright throw.
- **[u106-1 · test-gap/high/confirmed]** Security-critical provenance + source-pin logic (detectCoreInstall, provisionWorkspace) has zero tests
  - Files: `packages/plugin-self-update/src/core-update.ts` (L76-119, 225-270)
  - Fix: Add unit tests against a temp fixture: (a) findCoreScopeDir for both the global-install layout (parent IS @moxxy) and the workspace layout (ancestor has node_modules/@moxxy); (b) detectCoreInstall returning null on missing/corrupt package.json and parsing gitHead/repoUrl + normalizeGitUrl; (c) provisionWorkspace's HEAD-pin mismatch rejection using a local fixture git repo with a known divergent commit.
  - Test: vitest with tmpdir fixtures + a throwaway `git init` repo to assert the mismatch branch returns ok:false with the 'source mismatch' message.
- **[u116-2 · test-gap/medium/confirmed]** DeliveryDedupeCache (LRU + TTL eviction algorithm) has zero unit tests
  - Files: `packages/plugin-webhooks/src/dedupe.ts` (L10-54)
  - Fix: Add dedupe.test.ts covering: first key returns true then false on repeat; TTL expiry (inject ttlMs + fake clock or wait) re-admits a key; maxEntries overflow evicts the oldest while keeping recent; duplicate-hit refreshes recency; evictExpired stops at first fresh entry (insertion-order invariant).
  - Test: Vitest with vi.useFakeTimers / Date.now mock to drive ttl; assert size() and check() return values across eviction boundaries.
- **[u30-4 · test-gap/medium/confirmed]** Wizard control-flow and stdin line-queue concurrency logic have zero unit tests
  - Files: `packages/cli/src/wizard/run-setup-wizard.ts; packages/cli/src/wizard/auth-context.ts` (L83-279)
  - Fix: Add wizard.test.ts driving runSetupWizard with a fake controller + mocked @clack/prompts covering: apiKey happy path, OAuth happy path, OAuth retry-then-succeed, OAuth retry-decline → bail, key reject→retry, key reject→accept. Add auth-context.test.ts for stdinLinePrompt covering line queued-before-waiter, waiter-before-line, close-resolves-pending-empty.
  - Test: vitest with vi.mock('@clack/prompts') returning scripted answers and a stub SetupWizardController recording calls; assert config path returned and controller methods invoked in the right order.
- **[u25-4 · perf/low/confirmed]** groupSimilarPrompts is O(n^2 * tokens): re-tokenizes the whole group on every entry
  - Files: `packages/cli/src/commands/skills.ts` (L200-217)
  - Fix: Memoize tokens per entry once (Map<entry, Set<string>> or precompute an array of {entry, tokens}); maintain a running token Set per group and union the new entry's tokens on placement instead of rebuilding.
  - Test: Add a unit test asserting grouping output is unchanged after the refactor for a fixed set of prompts (snapshot the group membership).
- **[u25-6 · test-gap/medium/unverified-lowrisk]** Pure parsers/renderers (resolveId, groupSimilarPrompts, renderPlist, renderUnit) have no unit tests
  - Files: `packages/cli/src/commands/sessions.ts; packages/cli/src/commands/skills.ts; packages/cli/src/commands/service/launchd.ts; packages/cli/src/commands/service/systemd.ts`
  - Fix: Add table-driven unit tests: resolveId across exact/suffix/prefix/index/ambiguous; groupSimilarPrompts clustering thresholds; renderPlist/renderUnit golden output incl. XML/shell escaping of args+env.
  - Test: New vitest specs asserting fixed inputs map to fixed outputs; cover the escaping edge cases noted in u25-5 and the ambiguous-id fallthrough in u25 sessions.
- **[u112-6 · test-gap/medium/unverified-lowrisk]** Core completion-detection + output-cleaning logic (runCommand/cleanOutput) has no unit test
  - Files: `packages/plugin-terminal/src/terminal.ts; packages/plugin-terminal/src/pty.ts` (L118-163)
  - Fix: Add unit tests driving a fake TerminalProcess: (a) emit output then sentinel line, assert {output, exitCode, timedOut:false} and that echoed command/marker/printf lines are stripped; (b) never emit sentinel, assert timeout -> {exitCode:null, timedOut:true}; (c) cleanOutput edge cases (command containing the marker substring, multi-line output). Plus TerminalProcessImpl tests for scrollback cap and emitExit idempotency.
  - Test: Vitest with an in-memory TerminalProcess stub implementing onData/onExit/write/scrollback.
- **[u122-3 · test-gap/medium/unverified-lowrisk]** computeElisionState recall-pin/maxRecallBytes cap + adaptive auto-disable have no direct unit test
  - Files: `packages/sdk/src/elision-state.ts` (L78-163)
  - Fix: Add an elision-state.test.ts that unit-tests computeElisionState directly: (a) HWM picks the max elidedThrough across multiple elision events; (b) recall callId/seq bookkeeping; (c) maxRecallBytes cap correctly stubs the oldest aged recalls once cumulative bytes exceed the cap (newest-first); (d) effectiveElideConversational flips false once seqRecalls reaches conversationalRecallThreshold; (e) toolResultStubbed/conversationalStubbed boundary cases (TINY_TURN_CHARS, firstUserPromptSeq anchor, neverElide).
  - Test: Pure-function table tests with hand-built event arrays; assert each ElisionState field. No mocks needed.
- **[u46-4 · test-gap/low/unverified-lowrisk]** extractMarkdownBlock (LLM-output unwrapping) has no direct unit test
  - Files: `packages/core/src/skills/synthesize-draft.ts` (L38-46)
  - Fix: Add a small unit test for extractMarkdownBlock (export it or test via draftSkill): bare text, ```markdown-fenced, ```md-fenced, and content-containing-backticks cases.
  - Test: Table-driven test over the four input shapes asserting the extracted inner block.
- **[u44-4 · test-gap/low/unverified-lowrisk]** loadPreferences mode-migration branch (migrateModeName) is untested
  - Files: `packages/core/src/preferences.ts` (L38-50)
  - Fix: Add preferences.test.ts: (a) missing/malformed file -> {}; (b) a legacy mode value round-trips through migrateModeName to the migrated name; (c) savePreferences merges a patch without clobbering unrelated fields and writes atomically (assert tmp+rename via fs spy or by reading the file back). Use a temp HOME or pass an explicit path-injection (note: load/savePreferences hard-code preferencesPath() with no path arg — see u44-5).
- **[u44-5 · consistency/low/unverified-lowrisk]** preferences load/save hard-code preferencesPath() with no injectable path (unlike usage-stats)
  - Files: `packages/core/src/preferences.ts` (L38-71)
  - Fix: Add an optional `filePath: string = preferencesPath()` parameter to both functions, mirroring usage-stats. This is non-breaking (default preserves current behavior) and unblocks u44-4's test.
  - Test: After adding the param, the u44-4 tests drive it against a tmp file; assert default still targets preferencesPath() when omitted.

### [t3-longtail-review] Long-tail: minor correctness / robustness nitpicks

- **Lens:** review | **Risk:** low | **Effort:** L | **Findings merged:** 116
- **Packages:** apps/desktop, apps/mobile-poc, packages/cli, packages/client-core, packages/client-transport-ws, packages/config, packages/core, packages/desktop-host, packages/ipc-server-ws, packages/isolator-wasm, packages/isolator-worker, packages/mode-deep-research, packages/mode-goal, packages/plugin-browser, packages/plugin-channel-http, packages/plugin-channel-mobile, packages/plugin-channel-web, packages/plugin-cli, packages/plugin-commands, packages/plugin-computer-control, packages/plugin-embeddings-transformers, packages/plugin-mcp, packages/plugin-memory, packages/plugin-oauth, packages/plugin-provider-anthropic, packages/plugin-provider-openai, packages/plugin-provider-openai-codex, packages/plugin-scheduler, packages/plugin-security, packages/plugin-self-update, packages/plugin-telegram, packages/plugin-terminal, packages/plugin-usage-stats, packages/plugin-vault, packages/plugin-view, packages/plugin-webhooks, packages/plugin-workflows, packages/runner, packages/sdk, packages/tools-builtin, packages/workflows-builder

**What / why:** Low-severity correctness and robustness nitpicks across many files (swallowed errors, minor edge cases, defensive-fill gaps) that did not rise to the targeted bug clusters. (116 deduped findings.)

**Rationale / risk:** Low severity, low risk; address opportunistically when the owning file is next touched (TECH_DEBT journal).

<details><summary>116 merged findings (file — title)</summary>

- `apps/desktop/electron/main/index.ts` [u6-6/low] Boot probe re-arms only on the first did-finish-load; an OAuth-recovery reload before confirm is not re-probed
- `apps/desktop/electron/main/shell-updater.ts` [u6-3/low] installFullAppUpdate leaves a download-progress listener on the singleton autoUpdater after it returns
- `apps/desktop/src/chat/UsageModal.tsx` [u2-2/low] onCompact can setState after unmount; cleanup relies on modal staying open
- `apps/desktop/src/chat/command-palette/CommandPalette.tsx` [u4-3/low] session-action 'exit' directive is silently ignored by the desktop palette
- `apps/desktop/src/connection/ConnectionScreen.tsx` [u5-1/low] runUpdate awaits onUpdateCli without try/catch — a rejecting promise strands the spinner
- `apps/desktop/src/connection/ConnectionScreen.tsx` [u5-2/low] Reinstall note text is hardcoded to 'app older than runner' even when the real cause is no updater wired
- `apps/desktop/src/focus/FocusWidget.tsx` [u7-4/low] Activation fires focus.resize twice (once at width 232, again once hasTranscriber resolves)
- `apps/desktop/src/onboarding/Onboarding.tsx` [u9-4/low] Late node-probe inserts the node step mid-list; linear cursor can misalign
- `apps/desktop/src/settings/MobileTab.tsx` [u11-5/low] copyUrl setTimeout not cleared on unmount → setState-on-unmounted warning
- `apps/desktop/src/settings/shared/useAgentTask.ts` [u12-3/low] Turn hiding races IPC ordering: hideTurn(id) runs only after the runTurn invoke resolves
- `apps/desktop/src/shell/ContextRail.tsx` [u13-3/low] Resize drag registers window listeners that leak if the rail unmounts mid-drag
- `apps/desktop/src/shell/surfaces/BrowserPane.tsx` [u13-2/low] Browser pane forwards keys to the page but never preventDefault — Tab/arrows leak to the host UI
- `apps/desktop/src/shell/workspace-sidebar/ProfilePill.tsx` [u14-1/low] Identity-persist effect keyed only on user.id can miss late-hydrating displayName
- `apps/desktop/src/workflows/NodeInspector.tsx` [u15-8/low] Numeric fields dispatch NaN on empty input (retries / maxIterations)
- `apps/desktop/src/workflows/WorkflowsPanel.tsx` [u16-2/low] last-run pre renders steps via JSON.stringify on every render, no fallback for empty result
- `apps/mobile-poc/src/App.tsx` [u19-3/low] AskPrompt can respond with an empty optionId when approval options are missing
- `apps/mobile-poc/src/App.tsx` [u19-2/low] bootMobile() invoked as a side effect inside useState lazy initializer
- `packages/cli/src/argv.ts` [u26-4/low] parseArgv greedily consumes the next token as a flag value, mis-parsing boolean flag + positional
- `packages/cli/src/commands/channels.ts` [u23-2/low] `moxxy channels` list path discards user argv flags (--config / --verbose / --model)
- `packages/cli/src/commands/schedule/daemon.ts` [u24-2/low] Foreground daemon stops the poller but never closes the session (onShutdown hooks skipped)
- `packages/cli/src/commands/service/systemd.ts` [u25-5/low] systemd Environment= values are not escaped/quoted (latent injection if a spec sets env)
- `packages/cli/src/commands/start-registered-channel.ts` [u25-7/low] Channel options merged with `as never` cast + raw argv.flags spread (weak typing, flag bleed)
- `packages/cli/src/setup/scheduler-runner.ts` [u28-5/low] lastError is sticky: an early error-stopReason assistant_message poisons a later successful turn result
- `packages/cli/src/setup/workflows.ts` [u28-7/low] resumeNow bypasses the inFlight guard, allowing a resume to race a fresh run of the same workflow
- `packages/cli/src/wizard/run-setup-wizard.ts` [u30-3/low] collectKey accepts a provider-REJECTED key when user declines retry, conflating it with network-error case
- `packages/client-core/src/useChat.ts` [u33-3/low] Module-level titleRefreshTimer not cleared when ChatStoreBridge unmounts
- `packages/client-transport-ws/src/index.ts` [u36-3/low] makeWsApi.invoke silently drops positional args beyond the first
- `packages/client-transport-ws/src/json-rpc-client.ts` [u36-1/low] Status stays 'open' for the whole backoff window after a link drop
- `packages/config/src/loader.ts` [u38-4/low] Module-global cachedJiti is keyed by the first cwd seen, stale for later .ts configs elsewhere
- `packages/config/src/merge.ts` [u38-6/low] mergeConfigs concatenates arrays, silently violating documented 'later wins' for replace-semantics fields
- `packages/core/src/events/log.ts` [u39-2/low] Constructor seeds events without aligning base to seed[0].seq — latent index/seq desync
- `packages/core/src/permissions/engine.ts` [u40-4/low] String(input[k]) collapses objects/arrays to '[object Object]', so inputMatches can't match structured input
- `packages/core/src/plugins/loader.ts` [u41-2/low] jiti instance is a module-global singleton keyed to the first cwd, ignoring later cwds
- `packages/core/src/registries/modes.ts` [u42-3/low] ModeRegistry.replace of the active mode does not notify onActiveChange listeners despite the def changing
- `packages/core/src/registries/providers.ts` [u42-4/low] ProviderRegistry.replace on the active provider leaves a transient 'active but no instance' window
- `packages/core/src/sessions/persistence.ts` [u45-3/low] Final index write on detach uses an unref'd 250ms timer; close-time lastActivity can be lost on immediate exit
- `packages/core/src/sessions/persistence.ts` [u45-1/low] First-event append can race ahead of ensureDir() on a fresh sessions dir -> spurious degraded warning
- `packages/core/src/skills/loader.ts` [u46-5/low] loadDir aborts an entire skill directory tree if one .md file is unreadable
- `packages/core/src/subagents/events.ts` [u47-5/low] Child-event streaming silently swallows every parent-log append failure
- `packages/core/src/tunnel/localhost.ts` [u49-1/low] localhost tunnel URL does not bracket IPv6 hosts
- `packages/core/src/view/parse.ts` [u50-2/low] HTML entities decoded in text nodes but NOT in attribute values (inconsistent)
- `packages/core/src/view/parse.ts` [u50-3/low] Unknown tag emits N+1 redundant errors (one per attribute) on top of the tag error
- `packages/desktop-host/src/app-update/stager.ts` [u52-6/low] content-length from a chunked/compressed response yields a wrong/absent progress total
- `packages/desktop-host/src/node-manager.ts` [u57-5/low] managedNodeBinDir sort uses a non-total-order comparator to prefer the pinned version
- `packages/desktop-host/src/workspace-fs.ts` [u58-5/low] listDir does not re-validate that each child symlink stays inside the workspace root
- `packages/ipc-server-ws/src/ws-transport.ts` [u61-3/low] Slow-reader eviction in send() is silent to the JsonRpcPeer — a dropped request response leaves a pending caller
- `packages/ipc-server-ws/src/ws-transport.ts` [u61-1/low] Connection-cap check (verifyClient) and the connections counter race; cap can be exceeded
- `packages/isolator-wasm/src/index.ts` [u63-6/low] broker_fs_write_file forces UTF-8 round-trip, corrupting any non-UTF-8 byte payload
- `packages/isolator-wasm/src/index.ts` [u63-2/high] Host scratch allocator (fixed base 65536) and the module's own alloc() share one Memory with no coordination — heap corruption
- `packages/isolator-worker/src/index.ts` [u64-3/low] worker message/error/exit listeners not added to cleanup set (rely solely on terminate)
- `packages/mode-deep-research/src/research-loop.ts` [u65-4/low] No abort check between synthesis approval and emitting the synthesized message
- `packages/mode-goal/src/goal-loop.ts` [u67-3/low] Reasoning of the budget-exhausting call is dropped because the budget check returns before the reasoning emit
- `packages/plugin-browser/src/html-extract.ts` [u68-4/low] Markdown link extraction drops single-quoted and unquoted href URLs
- `packages/plugin-browser/src/sidecar.ts` [helper-reuse-4/medium] Browser sidecar hand-rolls a promise-chain mutex (createMutex) and loses its rejection-resilience
- `packages/plugin-channel-http/src/channel.ts` [u70-5/low] start() called twice overwrites this.server and leaks the prior listening server
- `packages/plugin-channel-mobile/src/single-session-host.ts` [u71-3/low] dispose() leaves the permission resolver pointing at the disposed host
- `packages/plugin-channel-mobile/src/single-session-host.ts` [u71-4/low] autoApprove is never reset on /new and bypasses always-allow persistence
- `packages/plugin-channel-web/src/channel.ts` [u73-5/low] Empty prompt-frame action is silently swallowed with no ack to the browser
- `packages/plugin-channel-web/src/channel.ts` [u73-4/low] TOCTOU between pidCommand identity check and process.kill — PID may be reused before SIGTERM
- `packages/plugin-channel-web/src/frontend/socket.ts` [u72-4/low] ServerFrame 'view' frame's `replaces` field is silently ignored by the frontend reducer
- `packages/plugin-cli/src/clipboard-image.ts` [u77-2/low] image-cache dir grows unbounded — clipboard PNGs are never reaped
- `packages/plugin-cli/src/components/ApprovalDialog.tsx` [u74-5/low] ApprovalDialog clamps scrollOffset for render but never resets the stale state, leaking offset across content
- `packages/plugin-cli/src/components/ApprovalDialog.tsx` [u74-3/low] ApprovalDialog j/k scroll silently shadows options whose hotkey is 'j' or 'k'
- `packages/plugin-cli/src/components/ListPicker.tsx` [u74-8/low] ListPicker 'land cursor on current' effect omits filtered from deps, can stomp/miss on first paint
- `packages/plugin-cli/src/components/PermissionDialog.tsx` [u74-10/low] PermissionDialog has an empty useEffect with a misleading comment (dead plumbing)
- `packages/plugin-cli/src/components/markdown/table.tsx` [u76-7/low] Table width math uses string code-unit length, mis-sizing wide (CJK/emoji) cells
- `packages/plugin-cli/src/components/prompt/parse-input.ts` [u76-5/low] Ctrl+C hard-exits via process.exit(0) from inside the input parser, bypassing cleanup
- `packages/plugin-cli/src/session/run-slash.ts` [u78-6/low] openModelPicker mutates session.readyProviders as a side effect of opening a picker
- `packages/plugin-cli/src/session/use-image-attachments.ts` [u78-3/low] Image attachment map only cleared on non-slash submit; leaks placeholders across slash commands
- `packages/plugin-cli/src/session/use-turn-runner.ts` [u79-3/low] runTurn errors fully swallowed including AbortError vs real failures
- `packages/plugin-commands/src/index.ts` [u80-4/low] compactedEvents count derives from replacedRange seqs as if they were a dense count
- `packages/plugin-computer-control/src/shell.ts` [u81-2/medium] Timeout/abort kill is indistinguishable from a normal exit — callers cannot detect a timed-out child
- `packages/plugin-computer-control/src/tools/key.ts` [u82-4/low] key.ts single-char keystroke ignores its own KEY_CODES catalog for chars that map to named keys
- `packages/plugin-computer-control/src/tools/screenshot.ts` [u82-3/low] Screenshot temp filenames can collide under concurrent calls (Date.now() not unique within a ms)
- `packages/plugin-embeddings-transformers/src/embedder.ts` [u84-3/low] Constructor mutates global process.env.HF_HOME — global side effect, last-constructed wins
- `packages/plugin-embeddings-transformers/src/embedder.ts` [u84-4/low] Declared dim can disagree with the actual model output dimension (no verification)
- `packages/plugin-mcp/src/admin/config-io.ts` [u85-6/low] A single malformed server entry makes readMcpConfig silently discard the ENTIRE catalog
- `packages/plugin-mcp/src/admin/tools/remove.ts` [u85-3/low] mcp_remove_server runs detachServer outside the config mutex, racing a concurrent re-add of the same name
- `packages/plugin-mcp/src/index.ts` [u86-5/low] createMcpPlugin connects servers strictly serially; one slow server delays all
- `packages/plugin-mcp/src/wrap.ts` [u86-3/low] renderResult discards MCP image/resource payloads, returning only placeholders
- `packages/plugin-memory/src/store/io.ts` [u88-3/low] safeRead returns untrimmed body while listEntries/readEntry return trimmed body
- `packages/plugin-oauth/src/adapters/openai-device-flow.ts` [u89-3/low] poll() fetches are not abort-responsive (no signal threaded into the request)
- `packages/plugin-oauth/src/credential-lock.ts` [u91-7/low] Stale-lock takeover has a TOCTOU window (acknowledged best-effort, but two takers can collide)
- `packages/plugin-oauth/src/oauth/callback-server.ts` [u90-5/low] Redundant clearTimeout(timer) before settle() in every error branch
- `packages/plugin-provider-anthropic/src/provider.ts` [u94-4/low] countTokens skips OAuth freshness/401 handling, silently degrading to estimate after token expiry
- `packages/plugin-provider-openai-codex/src/codex/stream-consumer.ts` [u98-3/low] Truncated-stream flush silently drops function calls whose name never arrived
- `packages/plugin-provider-openai-codex/src/provider.ts` [u99-3/low] 401-retry replay does not re-test for 401; a second 401 falls through to a generic non-auth error
- `packages/plugin-provider-openai/src/provider.ts` [u100-1/low] reasoning_effort gated by max_completion_tokens regex drops effort for OpenAI-compatible reasoning backends
- `packages/plugin-scheduler/src/poller.ts` [u103-8/low] tickOnce return count undercounts: error fires and counts only via onFired
- `packages/plugin-scheduler/src/tools.ts` [u103-7/low] describeEntry computes nextFireAt from a different baseline than the poller's isDue, so UI can show a misleading next-fire
- `packages/plugin-security/src/broker.ts` [u105-9/low] brokerExec timeout-kill path leaves child running and resolves nothing extra, but timer not cleared on abort
- `packages/plugin-security/src/cap-check.ts` [u105-6/low] matchesGlob compiles a fresh RegExp per pattern per path on every check
- `packages/plugin-security/src/cap-check.ts` [u105-8/low] extractPaths file:// handling drops query/host and ignores percent-encoding
- `packages/plugin-self-update/src/core-update.ts` [u106-7/low] Loose-install fallback reports the frozen-lockfile error message on its own failure path
- `packages/plugin-telegram/src/channel.ts` [u111-2/low] mirrorForeignTurn does not filter event-log subscribers by turnId (invariant #8)
- `packages/plugin-telegram/src/channel/callback-handler.ts` [u110-6/low] Model switch mutates shared Session provider state from an unguarded callback — races concurrent turns
- `packages/plugin-telegram/src/channel/html.ts` [u110-4/low] stripHtml decodes only 4 named entities — numeric/&#39; entities survive plain-text fallback
- `packages/plugin-telegram/src/format.ts` [u111-4/low] Fence/inline placeholders use ` FENCEn `/` INLINEn ` text tokens that can collide with literal user content and consume surrounding spaces
- `packages/plugin-telegram/src/index.ts` [u111-6/low] telegram_send_message constructs a fresh grammy Bot per call and never closes it
- `packages/plugin-telegram/src/pair-flow.ts` [u111-8/low] pair-flow registers SIGINT/SIGTERM handlers on every run and calls process.exit; leaks listeners + bypasses caller
- `packages/plugin-terminal/src/pty.ts` [u112-8/low] Piped-backend write() can throw EPIPE between shell exit and the exit listener firing
- `packages/plugin-usage-stats/src/index.ts` [u113-1/low] cursor mixes EventLog.length (index count) with slice(seq) — only correct when base===0
- `packages/plugin-vault/src/crypto.ts` [u114-3/low] randomCode has modulo bias and silently loses range for digits >= 10
- `packages/plugin-view/src/index.ts` [u115-2/low] viewId from surface.nextViewId() is returned to the model but ignored by every consumer
- `packages/plugin-view/src/index.ts` [u115-3/low] rendered flag means 'a surface is attached', not 'the view was delivered'
- `packages/plugin-webhooks/src/runner.ts` [u116-3/low] Inbox filename keyed only on ISO timestamp + trigger name — bursts overwrite each other
- `packages/plugin-webhooks/src/server.ts` [u116-6/low] Filter evaluation runs before dedupe and re-parses body; ordering also re-runs verify-passed work on every retry
- `packages/plugin-workflows/src/loader.ts` [u118-3/low] loadDir aborts the entire discovery scan if a file is removed mid-scan
- `packages/plugin-workflows/src/store.ts` [u118-4/low] WorkflowStore has no concurrency guard around load()/read-modify-write ops
- `packages/runner/src` [boundaries-3/low] Near-miss (resolved): @moxxy/runner depends on a concrete mode block — confirmed dev-only, registry-driven at runtime
- `packages/runner/src/unix-socket.ts` [u121-3/low] createUnixSocketServer fans out to every onConnection handler but only ever needs one
- `packages/sdk/src/compactor-helpers.ts` [u122-6/low] estimateContextTokens double-pass over events allocates compactedSeqs Set unboundedly
- `packages/sdk/src/tunnel.ts` [u125-1/low] spawnCliTunnel matches urlRegex per stdout chunk — misses a URL split across chunks
- `packages/tools-builtin/src/bash.ts` [u128-6/low] Bash leaves stdout/stderr `pause`-able streams flowing; no guard if spawn returns null pipes under odd stdio
- `packages/workflows-builder/src/serialize.ts` [u129-7/low] autoLayout longest-path recursion can stack-overflow / mis-layer on cyclic input
- `packages/workflows-builder/src/yaml.ts` [u129-5/low] Block scalar parser ignores fold/strip chomping nuances and loses leading indentation

</details>

### [t3-longtail-test-gaps] Long-tail: add unit tests for the untested per-unit logic

- **Lens:** test-gap | **Risk:** low | **Effort:** L | **Findings merged:** 75
- **Packages:** apps/desktop, apps/fixture-recorder, packages/chat-model, packages/cli, packages/client-core, packages/client-platform-web, packages/config, packages/core, packages/desktop-host, packages/desktop-ui, packages/mode-deep-research, packages/mode-default, packages/mode-goal, packages/plugin-channel-mobile, packages/plugin-channel-web, packages/plugin-cli, packages/plugin-commands, packages/plugin-computer-control, packages/plugin-mcp, packages/plugin-memory, packages/plugin-oauth, packages/plugin-plugins-admin, packages/plugin-provider-admin, packages/plugin-provider-anthropic, packages/plugin-provider-claude-code, packages/plugin-provider-openai, packages/plugin-provider-openai-codex, packages/plugin-scheduler, packages/plugin-security, packages/plugin-self-update, packages/plugin-stt-whisper, packages/plugin-subagents, packages/plugin-telegram, packages/plugin-usage-stats, packages/plugin-workflows, packages/runner, packages/sdk, packages/testing, packages/tools-builtin, packages/workflows-builder

**What / why:** Pure parsers/reducers/folds/state-machines across the repo (prompt-editor reducer, escape parser, oauth orchestrators, mcp wrap, telegram channel logic, codex/anthropic stream folds, picker/queue reducers, AppleScript serialization, token-accounting fold, etc.) that lack co-located tests. (75 deduped findings.)

**Rationale / risk:** Additive, no behavior change. Lower priority than the Tier-3 test-harness items that unblock refactors; do opportunistically when each file is touched.

<details><summary>75 merged findings (file — title)</summary>

- `apps/desktop/electron/main/index.ts` [u6-2/medium] Security/health-critical deep-link parsing and boot-probe revert logic have zero unit tests
- `apps/desktop/src/App.tsx` [u10-2/medium] Multi-branch top-level render gate (onboarding/splash/CLI-missing/recovery/connected) has no unit test
- `apps/desktop/src/chat/chat-surface/suggestions.ts` [u3-1/medium] deriveSuggestions/pickTopic regex heuristic has zero unit tests
- `apps/desktop/src/chat/chat-surface/suggestions.ts` [u1-2/low] deriveSuggestions/pickTopic regex heuristics have no unit test
- `apps/desktop/src/chat/command-palette/steppers.ts` [u4-2/medium] Pure parsers stepsForCommand/quote/humanize have no unit tests
- `apps/desktop/src/focus/useLatestBlock.ts` [u7-5/low] useLatestBlock snapshot/cache logic (live-stream-wins, reverse scan, content memo) has no direct unit test
- `apps/desktop/src/lib/askSurface.ts` [u8-3/medium] Ask-surface ref-count store has no test despite gating a runner-blocking surface
- `apps/desktop/src/lib/useDeepLink.ts` [u8-4/low] DeepLinkBridge drain-before-subscribe ordering and store push are untested
- `apps/desktop/src/onboarding/flow.ts` [u9-5/low] ONBOARDING_STEPS gate predicates (full vs recovery routing) have no direct test
- `apps/desktop/src/settings/VaultTab.tsx` [u11-7/low] Vault key-name validation regex has no unit test
- `apps/desktop/src/settings/shared/OAuthSignIn.tsx` [u12-2/medium] OAuthSignIn login state machine (prompt/browser/done/cancel/loginId filtering) has no unit test
- `apps/desktop/src/shell/surfaces/DiffView.tsx` [u13-5/low] Diff line classification + git status-color logic have no unit test
- `apps/desktop/src/workflows/WorkflowCanvas.tsx` [u15-7/low] topoOrder and disconnectEdge have no direct unit test (only indirect coverage)
- `apps/fixture-recorder/src/index.ts` [u18-3/low] parseFlags (the only non-trivial pure logic) has no unit test
- `packages/chat-model/src/format.ts` [u22-1/medium] format.ts pure helpers (summarizeArgs/buildCompactSummary/formatElapsed/formatTokensK) have zero unit tests
- `packages/cli/src/commands/memory.ts` [u23-5/low] memory.ts fold/format pure helpers (groupByType, formatRelative, formatSize, prune cutoff) untested
- `packages/cli/src/commands/schedule/format.ts` [u24-6/low] fmtNext date/cron formatting helper has branchy logic and no unit test
- `packages/cli/src/error-formatter.ts` [u26-5/low] describeCauseChain depth-cap and nested-cause folding untested
- `packages/cli/src/setup/embedder.ts` [u28-6/low] Embedder selection / preference application / session-restore branching have no dedicated unit tests
- `packages/cli/src/update/registry.ts` [u29-4/low] fetchLatest transport (timeout/abort, !ok, malformed body) has no unit test
- `packages/client-core/src/chatPersistence.ts` [u32-4/low] migrateLegacyChats one-time data migration parser is untested (data-loss path)
- `packages/client-platform-web/src/pcm16.ts` [u35-3/medium] Chunked uint8ArrayToBase64 (the stack-overflow mitigation) has no test
- `packages/config/src/plugin.ts` [u38-5/low] config_set runtime-applier path, config_reload, and config_validate have no unit tests
- `packages/core/src/plugins/lifecycle.ts` [u41-6/low] HookDispatcher chaining/short-circuit reducers under-tested (rewrite vs deny precedence, request threading)
- `packages/core/src/session.ts` [u44-6/low] wrapWithPolicy Proxy passthrough of non-check methods (e.g. abortAll) is untested
- `packages/desktop-host/src/app-update/native-resolution.ts` [u52-5/low] setupNativeResolution has no unit test despite mutating NODE_PATH + internal Module._initPaths
- `packages/desktop-host/src/ipc/session.ts` [u54-2/low] session/settings/onboarding IPC handlers have no IPC-level test (mobile-reachable; attachment gate wiring untested)
- `packages/desktop-host/src/ipc/workspace-fs.ts` [u55-4/low] cwdForWorkspace's id-vs-session matching + fallback routing has no unit test
- `packages/desktop-host/src/workspace-fs.ts` [u58-6/low] Security-sensitive path-confinement (workspace-fs) and stale-socket sweep have no unit tests
- `packages/desktop-ui/src/Modal.tsx` [u60-3/low] Package has zero tests and no vitest config
- `packages/mode-deep-research/src/approval.ts` [u65-3/medium] Approval-gate logic (redraft-cap, cancel, headless auto-approve) has zero unit tests
- `packages/mode-default/src/turn-iterator.ts` [u66-2/low] Reactive-compaction-on-overflow and retryable-error paths have no unit test
- `packages/mode-goal/src/goal-loop.ts` [u67-2/medium] Goal-loop termination guards (token budget, iteration cap, reactive compaction) have no unit coverage
- `packages/plugin-channel-mobile/src/channel.ts` [u71-2/medium] MobileChannel.start/stop/rotateToken + the deny-before-host permissionResolver have no unit test
- `packages/plugin-channel-web/src/frontend/url-safety.ts` [u72-2/medium] Security-critical url-safety allow-list has no direct unit test
- `packages/plugin-cli/src/clipboard-image.ts` [u77-5/low] clipboard-image (the module with the require-in-ESM bug) has zero unit tests
- `packages/plugin-cli/src/components/AgentsPanel.tsx` [u74-2/medium] collectAgents subagent-event fold (a stateful reducer over plugin_event log) has no unit test
- `packages/plugin-cli/src/components/SlashCommands.tsx` [u75-4/medium] matchSlash ranking algorithm (exact > prefix > alias) has no unit test
- `packages/plugin-cli/src/components/prompt/escape.ts` [u76-4/medium] matchEscape terminal-sequence parser is untested (kitty modifiers, CSI variants)
- `packages/plugin-cli/src/components/prompt/reducer.ts` [u76-3/medium] Prompt editor reducer (insert/delete/kill/yank/paste, word-motion) has zero unit tests
- `packages/plugin-cli/src/session/picker-handlers.ts` [u78-4/medium] Picker dispatch + provider-switch credential logic has no unit test
- `packages/plugin-cli/src/session/use-turn-runner.ts` [u79-2/medium] Queue drain/priority/abort reducer logic has zero unit tests
- `packages/plugin-commands/src/index.ts` [u80-6/low] No test for /compact failure/empty/no-compactor branches or token formatting boundaries
- `packages/plugin-computer-control/src/shell.ts` [u81-3/medium] Security-critical no-shell spawn helpers (runProcess/runProcessBinary/ensureDarwin) have zero unit tests
- `packages/plugin-computer-control/src/tools/type.ts` [u82-2/medium] AppleScript string serialization and key-chord script building have zero unit coverage
- `packages/plugin-mcp/src/admin/index.ts` [u85-4/medium] admin/index.ts onInit boot loop, enableAndAttach, and listServers have zero unit coverage
- `packages/plugin-mcp/src/admin/schema.ts` [u85-5/low] validateAddServerInput per-kind required-field guard (the flat-schema enforcement) is untested
- `packages/plugin-mcp/src/wrap.ts` [u86-2/medium] No tests for MCP call timeout, post-abort late-resolve, or wrapMcpServerToolsLazy
- `packages/plugin-memory/src/store/search.ts` [u88-4/medium] recallVector persistent-cache stitch path (cache hit reuse on second recall) has no targeted test
- `packages/plugin-oauth/src/oauth/token-exchange.ts` [u90-3/low] parseTokenResponse field-normalization + refresh-rotation behavior untested
- `packages/plugin-oauth/src/run-login.ts` [u91-6/medium] runOauthLogin orchestrator has no unit test (browser/device branching, timeout capping)
- `packages/plugin-plugins-admin/src/config.ts` [u92-2/medium] config.ts enable/disable persistence has zero unit tests
- `packages/plugin-provider-admin/src/index.ts` [u93-2/medium] buildProviderAdminPluginWithApi.configure() has zero unit-test coverage
- `packages/plugin-provider-anthropic/src/provider.ts` [u94-2/medium] Reasoning/thinking stream translation + cache-usage capture + abort are untested
- `packages/plugin-provider-claude-code/src/provider.ts` [u95-2/low] createClaudeCodeClient does not assert that beta headers + identity preamble reach AnthropicProvider
- `packages/plugin-provider-openai-codex/src/codex/stream-consumer.ts` [u98-1/medium] consumeResponsesSse streaming fold has no direct unit test for tool-call / terminal / flush paths
- `packages/plugin-provider-openai/src/provider.ts` [u100-2/low] Reasoning-delta streaming path (reasoning_content/reasoning) has no unit test
- `packages/plugin-scheduler/src/cron.ts` [u103-4/medium] No test exercises nextFireTime with an explicit IANA timeZone or month/year wraparound
- `packages/plugin-security/src/cap-check.ts` [u105-5/medium] matchesGlob/hostMatches/pathInScope traversal & wildcard edges untested
- `packages/plugin-security/src/isolators/none.ts` [u104-2/low] noneIsolator (security passthrough gate) has no unit test
- `packages/plugin-self-update/src/classify.ts` [u106-2/medium] gatherSignals event-log fold is untested (classify tests inject synthetic signals)
- `packages/plugin-stt-whisper/src/audio.ts` [u108-4/low] audio.ts WAV/normalize helpers + WhisperTranscriber.run() error classification have no in-package tests
- `packages/plugin-subagents/src/dispatch-agent.ts` [u109-1/medium] resolveSpec merge/precedence logic has no direct unit test
- `packages/plugin-telegram/src/approval.ts` [u111-5/medium] TelegramApprovalResolver (security/approval gate) has no unit test
- `packages/plugin-telegram/src/channel/frame-pump.ts` [u110-7/medium] Core channel logic (frame pump, slash dispatch, pairing, text dispatch, turn runner) has no unit tests
- `packages/plugin-usage-stats/src/index.ts` [u113-2/low] No test for onShutdown-without-onInit (cursor defaults to 0 → folds whole log)
- `packages/plugin-workflows/src/command.ts` [u118-5/medium] command.ts, engine.ts, and tools.ts have no unit tests
- `packages/plugin-workflows/src/executor/dag.ts` [u117-7/low] No tests for nested-workflow pause, true wave concurrency, or the stall-detection path
- `packages/runner/src/server.ts` [u120-4/medium] Resolver fall-through routing (scoped vs unscoped, client-doesn't-handle) has no unit test
- `packages/runner/src/unix-socket.ts` [u121-4/low] NdjsonTransport drops malformed frames silently with no test
- `packages/sdk/src/mode.ts` [u123-4/low] migrateModeName (legacy mode-name migration gate) has no unit test
- `packages/sdk/src/token-accounting.ts` [u124-2/medium] Cost-math fold (foldResponses: billedInputEq/savedRatio/cacheHitRate/cacheEffective) has no unit test
- `packages/testing/src/hash.ts` [u127-3/medium] stableStringify / hashRequest determinism has no direct unit test
- `packages/tools-builtin/src/recall.ts` [u128-5/low] recall `seq` and `turnId` branches (and renderEvent fold) have no unit tests
- `packages/workflows-builder/src/yaml.ts` [u129-4/medium] Hand-rolled YAML codec has only one edge-case test; parser branches largely uncovered

</details>

### [t3-longtail-consistency] Long-tail: consistency / naming / small-duplication nitpicks

- **Lens:** consistency | **Risk:** low | **Effort:** L | **Findings merged:** 49
- **Packages:** apps/desktop, apps/fixture-recorder, packages/chat-model, packages/cli, packages/client-core, packages/client-transport-ws, packages/core, packages/desktop-host, packages/desktop-ipc-contract, packages/isolator-subprocess, packages/mode-deep-research, packages/plugin-channel-http, packages/plugin-channel-mobile, packages/plugin-cli, packages/plugin-mcp, packages/plugin-memory, packages/plugin-provider-claude-code, packages/plugin-provider-openai, packages/plugin-provider-openai-codex, packages/plugin-security, packages/plugin-self-update, packages/plugin-stt-whisper, packages/plugin-telegram, packages/plugin-terminal, packages/plugin-workflows, packages/runner, packages/sdk, packages/testing, packages/tools-builtin

**What / why:** Low-severity consistency deviations, naming, and small copy-paste that did not form a cross-cutting dedup theme. (49 deduped findings.)

**Rationale / risk:** Cosmetic/structural nitpicks; fold into the relevant refactor PR when the file is touched.

<details><summary>49 merged findings (file — title)</summary>

- `apps/desktop/electron/main/index.ts` [u6-5/low] App product name 'MoxxyAI Workspaces' duplicated as a literal across 6+ sites in two files
- `apps/desktop/src/App.tsx` [u10-3/low] Duplicated fixed-bottom-center inline-style block across GlobalAskFallback and ReconnectBanner
- `apps/desktop/src/chat/UsageModal.tsx` [u2-1/low] UsageModal re-implements formatTokensShort (with a divergent M precision)
- `apps/desktop/src/chat/agent-picker/AgentPicker.tsx` [u2-5/low] AgentPicker duplicates the session.info fetch logic in two places (refresh + effect)
- `apps/desktop/src/focus/useLatestBlock.ts` [u7-6/low] Content cache key uses length + 64-char prefix slice — can return a stale block on same-prefix edits
- `apps/desktop/src/lib/useTheme.ts` [u8-2/low] useThemePreference uses an inline per-render subscribe (resubscribe churn) — diverges from sibling stores
- `apps/desktop/src/onboarding/steps/ProviderStep.tsx` [u9-3/low] Steps bypass useOnboarding's saveProviderKey/refresh helpers, leaving status stale
- `apps/desktop/src/shell/surfaces/FilesPane.tsx` [u13-6/low] absPath join logic duplicated between FilesPane.detailFor and WorkspaceFiles.FileRow
- `apps/fixture-recorder/src/index.ts` [u18-4/low] Docs/description say 'JSONL' but recorder writes pretty-printed .json fixtures
- `packages/chat-model/src/format.ts` [u22-3/low] dotColorForTool only resolves mcp/tool; DotColors.skill/subagent/other are picked by callers, leaving the helper a partial abstraction
- `packages/cli/src/commands/client-mode.ts` [u23-3/low] collectExtraFlags leaks launcher-internal flags (no-wizard, __skipWizard) into channel.start()
- `packages/cli/src/commands/schedule/daemon.ts` [u24-5/low] Status-table rendering (key/value rows + col padEnd + write loop) copy-pasted across 3 commands
- `packages/cli/src/setup/builtins.ts` [u28-2/low] buildBuiltinsCore reads UNRESOLVED rawConfig; ${vault:..} placeholders in those fields won't resolve
- `packages/client-core/vitest.config.ts` [u34-1/low] Local include re-lists src/**/*.test.ts; mergeConfig concatenates, leaving a duplicate glob
- `packages/client-transport-ws/src/index.ts` [u36-2/low] WS subprotocol/bearer constants duplicated from @moxxy/sdk channel-auth (drift risk)
- `packages/core/src/events/log.ts` [u39-1/low] Orphaned clear() docblock sits above rebase() — doc/method mismatch
- `packages/core/src/registries/commands.ts` [u42-2/low] CommandRegistry.register does not detect a primary name colliding with an existing alias
- `packages/core/src/registries/tools.ts` [u42-6/low] ToolRegistryImpl.execute formats input ZodErrors cleanly but lets output ZodErrors throw raw
- `packages/desktop-host/src/installer.ts` [u56-7/low] probeNode doc says 250ms budget but the timeout is 2000ms
- `packages/desktop-host/src/ipc/connection.ts` [u54-1/low] Inline `args?.workspaceId ?? pool.activeWorkspaceId()` duplicates the shared resolveSupervisor fallback
- `packages/desktop-host/src/ipc/desks.ts` [u54-3/low] `dialog.showOpenDialog(window ?? null!, ...)` non-null-asserts a possibly-null window
- `packages/desktop-ipc-contract/src/validation.ts` [u59-3/low] ask.respond response.mode enum is duplicated from SDK PermissionMode and can silently drift
- `packages/isolator-subprocess/src/index.ts` [u62-2/medium] Re-implements shared buildBrokerEnv helper + duplicates DEFAULT_ENV from plugin-security
- `packages/mode-deep-research/src/research-loop.ts` [u65-5/low] originalPrompt uses only the FIRST user_prompt while the planner is fed ALL of them
- `packages/plugin-channel-http/src/router.ts` [u70-4/low] Defensive `events.findLast?.()` optional-chaining hides a silent empty-assistant path
- `packages/plugin-channel-mobile/src/single-session-host.ts` [u71-5/low] session.runCommand casts the session through `as unknown as` to satisfy the command handler
- `packages/plugin-cli/src/components/PermissionEditor.tsx` [u74-7/low] PermissionEditor `visible` useMemo is a no-op identity wrapper around rows
- `packages/plugin-cli/src/context-estimate.ts` [u77-4/low] eventChars/safeJsonLen and the fullWalk algorithm are a hand-copied clone of the SDK's private estimator
- `packages/plugin-mcp/src/admin/config-io.ts` [u85-1/low] setServerDisabled/removeServerFromConfig hand-roll the read-modify-write that mutateMcpConfig already encapsulates
- `packages/plugin-mcp/src/wrap.ts` [u86-1/low] wrapOneTool and wrapOneLazyTool are near-identical copy-paste
- `packages/plugin-memory/src/embedding-cache.ts` [u87-4/low] EmbeddingIndex partially reinvents @moxxy/sdk CachedEmbeddingProvider
- `packages/plugin-memory/src/store/io.ts` [u88-2/low] read->parse->safeParse triplicated across safeRead, listEntries, readEntry
- `packages/plugin-provider-claude-code/src/index.ts` [u95-3/low] Internal Claude constants (CLAUDE_CODE_SYSTEM, CLAUDE_OAUTH_BETA, CLAUDE_CODE_SERVICE_NAME) leaked through public surface but unused externally
- `packages/plugin-provider-openai-codex/src/codex/sse-event-handler.ts` [u98-2/low] Duplicated JSON.parse + _rawPartial fallback for tool args in two places
- `packages/plugin-provider-openai/src/provider.ts` [u100-3/low] Inner consumption-loop catch does not special-case abort like the Anthropic provider does
- `packages/plugin-security/src/broker.ts` [u105-7/low] Commands allowlist basename match accepts any path with a matching basename
- `packages/plugin-self-update/src/core-update.ts` [u106-4/low] Two near-identical child-process spawn+collect runners (run / runCmd) plus duplicate trunc/truncate
- `packages/plugin-stt-whisper/src/whisper.ts` [u108-2/low] DEFAULT_FILENAMES in whisper.ts duplicates WHISPER_FILENAME_BY_MIME in audio.ts verbatim
- `packages/plugin-telegram/src/channel/voice-handler.ts` [u110-8/low] Voice download failure logs a hardcoded placeholder instead of the real HTTP status
- `packages/plugin-telegram/src/format.ts` [u111-7/low] Duplicated HTML-escape helpers across format.ts, render.ts (and ad-hoc unescape in html.ts)
- `packages/plugin-terminal/src/terminal.ts` [u112-5/low] Surface emit() loop lacks the per-callback try/catch that TerminalProcessImpl uses
- `packages/plugin-workflows/src/command.ts` [u118-7/low] slugify duplicated between command.ts and store.ts
- `packages/plugin-workflows/src/command.ts` [u118-6/low] triggerSummary duplicated verbatim in command.ts and tools.ts (drifting separator)
- `packages/runner/src/unix-socket.ts` [u121-2/low] reclaimStaleSocket re-implements isRunnerUp's connect-probe (copy-paste)
- `packages/sdk/src/index.ts` [u123-3/low] ElisionEvent interface is the only MoxxyEvent member not re-exported from the SDK barrel
- `packages/sdk/src/install-hints.ts` [u123-6/low] getInstallHint hardcodes apt for all Linux, silently wrong on Fedora/Arch/etc.
- `packages/testing/src/record-replay.ts` [u127-4/low] RecordedProvider.writeFixture uses non-atomic writeFile (no tmp+rename)
- `packages/tools-builtin/src/grep.ts` [u128-3/low] Grep and Glob diverge on symlink handling and cycle-safety despite sharing the walk concern
- `packages/tools-builtin/src/recall.ts` [u128-1/low] recall.ts imports `z` from 'zod' directly instead of '@moxxy/sdk' like every sibling tool

</details>

### [t3-longtail-perf] Long-tail: minor perf nitpicks

- **Lens:** perf | **Risk:** low | **Effort:** L | **Findings merged:** 41
- **Packages:** apps/desktop, apps/mobile-poc, packages/cli, packages/client-core, packages/client-platform-web, packages/core, packages/desktop-host, packages/ipc-server-ws, packages/isolator-wasm, packages/mode-default, packages/mode-goal, packages/plugin-channel-web, packages/plugin-cli, packages/plugin-memory, packages/plugin-oauth, packages/plugin-provider-openai-codex, packages/plugin-scheduler, packages/plugin-self-update, packages/plugin-vault, packages/plugin-workflows, packages/runner, packages/tools-builtin

**What / why:** Low-severity perf observations (small redundant work, minor allocations) below the threshold of the targeted perf clusters. (41 deduped findings.)

**Rationale / risk:** Marginal wins; bundle opportunistically with nearby work.

<details><summary>41 merged findings (file — title)</summary>

- `apps/desktop/src/shell/surfaces/DiffView.tsx` [u13-4/low] DiffView re-splits + re-styles the entire diff on every render with index keys
- `apps/desktop/src/workflows/WorkflowCanvas.tsx` [u15-2/low] Native wheel listener detached/reattached on every pan and zoom
- `apps/mobile-poc/src/App.tsx` [u19-1/low] Chat re-maps the entire event log on every keystroke (no memo)
- `packages/cli/src/commands/channels.ts` [u23-6/low] `moxxy <channel>` boots/registers plugins up to three times (channels probe → run-channel probe → real boot)
- `packages/cli/src/commands/service/common.ts` [u25-3/low] fileExists reads entire file content instead of stat/access
- `packages/cli/src/setup/activate-provider.ts` [u28-8/low] readyProviders probe resolves credentials sequentially for every registered provider on every boot
- `packages/client-core/src/useContextUsage.ts` [u33-2/low] session.info fetched per-component (component-local state), not shared/deduped
- `packages/client-platform-web/src/pcm16.ts` [u35-5/low] pcm16Peak constructs a DataView and does per-sample getInt16 instead of a direct Int16Array view
- `packages/core/src/permissions/engine.ts` [u40-3/low] Regexes recompiled on every check() call (inputMatches + glob name patterns)
- `packages/core/src/plugins/discovery.ts` [u41-5/low] Discovery reads every package.json strictly sequentially across up to 8 node_modules roots
- `packages/core/src/plugins/loader.ts` [u41-3/low] Always-on cache-bust query on dynamic import leaks ESM module entries on repeated reload
- `packages/core/src/session.ts` [u44-1/low] appContext() clones the entire process.env on every appended event
- `packages/core/src/usage-stats.ts` [u44-3/low] mergeUsageStats reads the whole usage file under the mutex even for an empty delta
- `packages/desktop-host/src/attachment-authz.ts` [u56-8/low] authorizeAttachments realpaths attachments sequentially in an await-in-loop
- `packages/desktop-host/src/chat-log.ts` [u56-5/low] appendEvents calls stat() twice and re-stats after append just to refresh mtimeMs
- `packages/desktop-host/src/ipc/workspace-fs.ts` [u55-3/low] cwdForWorkspace re-reads+parses desks.json on every IPC, and double-loads when workspaceId misses
- `packages/desktop-host/src/session-titles.ts` [u58-1/low] withSessionTitles re-reads every auto-named session's .meta.json on every list call (no cache)
- `packages/ipc-server-ws/src/ws-command-bus.ts` [u61-4/low] attach() allocates a fresh closure per registered command for every connection
- `packages/ipc-server-ws/src/ws-command-bus.ts` [u61-2/low] broadcast() re-serializes the identical payload once per peer
- `packages/isolator-wasm/src/index.ts` [u63-4/low] Scratch bump-allocator never reclaims within a call — N broker ops grow memory O(sum of all result sizes)
- `packages/mode-default/src/turn-iterator.ts` [u66-3/low] System-prompt+skill-catalog string rebuilt on every loop iteration
- `packages/mode-goal/src/goal-loop.ts` [u67-1/low] detectGoalTerminal copies the whole event log every productive iteration → O(n^2) per run
- `packages/plugin-channel-web/src/channel.ts` [u73-3/low] views Map grows unbounded across distinct view names and is fully replayed to every new client
- `packages/plugin-channel-web/src/frontend/socket.ts` [u72-3/low] Transcript messages array grows unbounded for the life of the surface session
- `packages/plugin-cli/src/components/AgentsPanel.tsx` [u74-1/low] AgentsPanel re-folds entire event log + rebuilds/sorts timeline on every render
- `packages/plugin-cli/src/components/ApprovalDialog.tsx` [u74-4/low] ApprovalDialog re-splits + re-colorizes the full body on every render (incl. each scroll/keystroke)
- `packages/plugin-cli/src/components/ToolsPanel.tsx` [u75-6/low] process.stdout.columns read inside per-row render (ToolsPanel ToolRow) instead of once
- `packages/plugin-cli/src/session/OverlayOrNotice.tsx` [u78-2/low] AgentsPanel/UsagePanel re-fold the entire events array on every event during a streaming turn
- `packages/plugin-memory/src/store.ts` [u87-3/low] recall() re-reads + re-parses every memory file from disk on every call, ignoring the in-memory row cache
- `packages/plugin-memory/src/store/search.ts` [u88-6/low] index.load() re-reads + re-parses .embeddings.json from disk on every recall
- `packages/plugin-memory/src/store/search.ts` [u88-5/low] scoreEntry counts token matches via haystack.split(t) — allocates a full array per token
- `packages/plugin-memory/src/store/search.ts` [u87-6/low] Keyword scoring builds a fresh array per (entry, query-token) via String.split
- `packages/plugin-oauth/src/storage.ts` [u91-5/low] readStoredCreds issues 10 sequential awaited vault.get calls instead of parallel
- `packages/plugin-provider-openai-codex/src/codex/stream-consumer.ts` [u98-4/low] Whole-buffer regex CRLF normalization re-runs on every chunk
- `packages/plugin-scheduler/src/cron.ts` [u103-5/low] Intl.DateTimeFormat allocated per cursor step inside the minute-walk for explicit zones
- `packages/plugin-self-update/src/classify.ts` [u106-3/low] gatherSignals scans the ENTIRE event log to build callNames, then uses only the lookback window
- `packages/plugin-self-update/src/transaction.ts` [u106-6/low] Abandoned open/verified transactions (each holding a full plugin snapshot) are never GC'd
- `packages/plugin-vault/src/placeholder.ts` [u114-1/low] resolveValue resolves object keys sequentially while arrays use Promise.all
- `packages/plugin-workflows/src/command.ts` [u118-8/low] readLastRun reads the entire latest run-record into memory to show a one-line summary
- `packages/runner/src/unix-socket.ts` [u121-5/low] NDJSON buffer uses O(n) slice per frame; pathological under many small frames in one chunk
- `packages/tools-builtin/src/read-handler.ts` [u128-4/low] Read slurps + splits the entire file even when only a small line window is requested

</details>

### [t3-longtail-deadcode] Long-tail: residual dead code beyond the proven-unused-export cluster

- **Lens:** deadcode | **Risk:** low | **Effort:** L | **Findings merged:** 21
- **Packages:** apps/desktop, packages/cli, packages/core, packages/design-tokens, packages/desktop-host, packages/isolator-wasm, packages/mode-deep-research, packages/plugin-computer-control, packages/plugin-oauth, packages/plugin-provider-claude-code, packages/plugin-provider-openai-codex, packages/plugin-stt-whisper, packages/plugin-telegram, packages/plugin-vault, packages/plugin-webhooks

**What / why:** Remaining dead branches / unused params / dormant plumbing flagged per-unit that were not in the global one-ref export cluster (re-verify each against invariant #11 before deletion). (21 deduped findings.)

**Rationale / risk:** Mostly safe deletions but each needs a dynamic-dispatch re-check; do alongside the owning package work.

<details><summary>21 merged findings (file — title)</summary>

- `apps/desktop/electron/main/ws-bridge.ts` [u6-4/low] wsBridgeTokenFile() export has no production caller (only its own test references it)
- `apps/desktop/src/focus/focus-icons.tsx` [u7-2/low] MicIcon `big` prop is never passed (only <MicIcon /> with default size)
- `apps/desktop/src/focus/focus-styles.ts` [u7-1/low] focus-mic-pulse keyframe injected but never referenced by any element
- `packages/cli/src/commands/memory.ts` [u23-1/low] Unused `node:path` import in memory.ts kept alive only by `void path;`
- `packages/cli/src/commands/run-tui.ts` [u24-3/low] Dead `Socket` import kept only to be `void`'d ('for parity with the desktop sweep helper')
- `packages/core/src/plugins/loader.ts` [u41-4/low] JitiLoaderOptions.cacheBust is dormant plumbing — no caller ever supplies it
- `packages/core/src/session.ts` [u44-2/low] registerHookOptions is a dead empty no-op stub with zero callers
- `packages/core/src/subagents/events.ts` [u47-2/low] mapNestedPluginEvent / `via` chaining is unreachable dormant plumbing in the current flatten design
- `packages/design-tokens/src/css-vars.ts` [u51-1/low] Package exports (generateThemeCss/RootCss, CSS_VAR_MAP, tokens) have no runtime consumer anywhere
- `packages/desktop-host/src/app-update/stager.ts` [u52-4/low] readAll's `_total` parameter is dead — never used
- `packages/desktop-host/src/prefs.ts` [u57-4/low] writePrefs exported but only used internally; not re-exported and no external importer
- `packages/isolator-wasm/src/index.ts` [u63-7/low] fetchWasmBytes is a public export with no external consumer (only used internally)
- `packages/mode-deep-research/src/parse-queries.ts` [u65-2/low] Empty `else if` continuation branch in parseNumberedBlock is a pure no-op
- `packages/plugin-computer-control/src/tools/type.ts` [u82-1/low] type.ts builds an unused `do shell script cat` AppleScript then discards it via `void script`
- `packages/plugin-oauth/src/oauth/device-flow.ts` [u90-4/low] DEVICE_POLL_SAFETY_MARGIN_MS = 0 is a no-op constant
- `packages/plugin-provider-claude-code/src/profile.ts` [u95-1/low] claudeOauthProfile (whole profile.ts) is dead — never consumed by the framework or any caller
- `packages/plugin-provider-openai-codex/src/oauth.ts` [u99-2/low] Dormant OAuth wrapper exports (exchangeCodeForTokens/buildAuthorizeUrl/generatePKCE/parseJwtClaims/DEFAULT_REDIRECT_URI/OAuthTokenResponse) with no live consumer
- `packages/plugin-stt-whisper/src/audio.ts` [u108-3/low] whisperFilenameFor exported but has zero consumers (internal or cross-package)
- `packages/plugin-telegram/src/channel/voice-handler.ts` [u110-2/low] VoiceHandlerState/Deps carry 8 never-read fields passed in from channel.ts
- `packages/plugin-vault/src/keysource.ts` [u114-2/low] MasterKeySource.persist() is dormant — no production caller invokes it
- `packages/plugin-webhooks/src/config.ts` [u116-4/low] ensureLoaded ENOENT branch is identical to its else branch (dead distinction)

</details>

### [t3-longtail-types] Long-tail: residual weak-typing nitpicks

- **Lens:** types | **Risk:** low | **Effort:** L | **Findings merged:** 19
- **Packages:** apps/desktop, packages/cli, packages/client-platform-web, packages/desktop-host, packages/isolator-wasm, packages/plugin-commands, packages/plugin-mcp, packages/plugin-provider-anthropic, packages/plugin-provider-openai, packages/plugin-stt-whisper, packages/plugin-stt-whisper-codex, packages/plugin-subagents, packages/plugin-telegram, packages/testing, packages/workflows-builder

**What / why:** Remaining any / unchecked-cast / non-exhaustive-switch spots not in the focused type-safety clusters. (19 deduped findings.)

**Rationale / risk:** Type-safety hardening, no behavior change; address when touching the file.

<details><summary>19 merged findings (file — title)</summary>

- `apps/desktop/src/chat/blocks/BlockView.tsx` [u2-4/low] BlockView switch has no exhaustiveness guard — a new Block kind silently renders nothing
- `apps/desktop/src/chat/command-palette/CommandPalette.tsx` [u4-4/low] session.info result narrowed via unchecked cast to SessionInfoSlice
- `apps/desktop/src/focus/focus-styles.ts` [u7-3/low] style record typed as Record<string,CSSProperties> erases key checking — typos compile
- `apps/desktop/src/settings/shared/useAgentTask.ts` [u12-4/low] Redundant inline re-typing of already-typed IPC subscribe payloads
- `packages/cli/src/wizard/run-setup-wizard.ts` [u30-5/low] guard<T>() return value redundantly re-cast at all 9 call sites, weakening the generic
- `packages/client-platform-web/src/audio-capture.ts` [u35-4/low] webkitAudioContext cast `(window as unknown as {...})` duplicated; should be one typed helper
- `packages/desktop-host/src/focus-window.ts` [u56-6/low] setVisibleOnAllWorkspaces accessed via double `as unknown as` cast (invariant #10 smell)
- `packages/desktop-host/src/session-driver.ts` [u58-2/low] runTurn passes opts via `as never`, disabling all RunTurnOptions field-checking to mask one branded-id mismatch
- `packages/isolator-wasm/src/index.ts` [u63-8/low] Double `as unknown as` / blind bigint cast on the wasm boundary masks real ABI shape mismatches
- `packages/plugin-commands/src/index.ts` [u80-5/low] ctx.session is `unknown` then cast to hand-written SessionShape/CompactSessionShape — bypasses type checking
- `packages/plugin-mcp/src/client.ts` [u86-4/low] defaultClientFactory leans on repeated `as unknown as` casts and `as never`
- `packages/plugin-provider-anthropic/src/provider.ts` [u94-3/low] Local `usage` accumulator typed without cache fields; relies on spread to dodge excess-prop check
- `packages/plugin-provider-openai/src/provider.ts` [u100-4/low] Entire chat.completions.create request body cast `as never`, erasing OpenAI SDK request typing
- `packages/plugin-stt-whisper-codex/src/index.ts` [u107-1/low] createClient merges untrusted config LAST, can clobber host-wired vault/fetch
- `packages/plugin-stt-whisper/src/whisper.ts` [u108-5/low] verbose_json response cast via `as unknown as` then trusted as { text: string } without validation
- `packages/plugin-subagents/src/dispatch-agent.ts` [u109-3/low] Unnecessary inline `(merged as { f?: T }).f = ...` casts in resolveSpec
- `packages/plugin-telegram/src/index.ts` [u111-9/low] Repeated `as never` / `as VaultStore` / `as ... | undefined` casts erode type safety at the deps boundary
- `packages/testing/src/matchers.ts` [u127-2/low] Unsafe literal cast `type as 'user_prompt'` in toContainEventOfType
- `packages/workflows-builder/src/serialize.ts` [u129-6/low] nodeToStep builds an untyped Record and casts `as unknown as WorkflowStep`, bypassing the SDK contract

</details>

### [t3-longtail-atomicity] Long-tail: smaller god-component / coupling splits

- **Lens:** atomicity | **Risk:** low | **Effort:** L | **Findings merged:** 13
- **Packages:** apps/desktop, packages/cli, packages/config, packages/core, packages/desktop-host, packages/plugin-channel-http, packages/plugin-cli, packages/plugin-computer-control, packages/plugin-webhooks, packages/sdk

**What / why:** Smaller single-file god-component / over-coupling findings (App.tsx gating+hotkey+heartbeat, oauth refresh dup, etc.) beneath the headline god-file cluster. (13 deduped findings.)

**Rationale / risk:** Structural; sequence after the headline god-file decomposition and dead-code shrink.

<details><summary>13 merged findings (file — title)</summary>

- `apps/desktop/src/App.tsx` [u10-1/medium] App.tsx is a god-component: gating + global hotkey + boot-heartbeat IPC + CLI self-heal + inline banners
- `apps/desktop/src/chat/blocks/ToolBlock.tsx` [u3-2/low] Avatar-tile + collapsible-header scaffold copy-pasted across three block components
- `packages/cli/src/setup/webhook-runner.ts` [u28-4/low] scopedSessionView hand-re-implements the entire RunTurnSession shape; brittle to runtime-protocol drift
- `packages/config/src/plugin.ts` [u38-3/low] Upward-walk + MAX_CONFIG_SEARCH_DEPTH duplicated between loader.ts and plugin.ts
- `packages/core/src/events/log.ts` [u39-3/low] append() and ingest() duplicate listener-snapshot + per-listener try/catch fanout
- `packages/core/src/view/parse.ts` [u50-4/low] Rich-component expansion (results→cards) is hardcoded, not registry-driven like other moxxy strategies
- `packages/desktop-host/src/runner-supervisor.ts` [u57-7/low] RunnerSupervisor is a god-class mixing CLI resolution, socket probing, process lifecycle, protocol-mismatch recovery, log-ring redaction, and phase machine
- `packages/plugin-channel-http/src/router.ts` [u70-3/low] runTurn drain + final-assistant extraction copy-pasted across all three turn handlers
- `packages/plugin-cli/src/components/chat/SubagentScopeView.tsx` [u76-6/low] Subagent status (running/error/done) color+label logic duplicated across scope/group views
- `packages/plugin-cli/src/session/SessionView.tsx` [u78-5/low] SessionView is a god-component mixing 8+ concerns (state, slash routing wiring, reset, init effects, render)
- `packages/plugin-computer-control/src/shell.ts` [u81-4/low] runProcess and runProcessBinary are near-duplicate copy-paste (abort/timer/error/close plumbing)
- `packages/plugin-webhooks/src/tunnel.ts` [u116-5/low] Tunnel providers wrapped as defineTunnelProvider but never registered — registry abstraction half-wired
- `packages/sdk/src/session-like.ts` [u124-4/low] session-like.ts is a god-file mixing the SessionLike contract with 6 unrelated admin-view DTOs

</details>

### [t3-longtail-completion] Long-tail: half-built / dormant features

- **Lens:** completion | **Risk:** low | **Effort:** L | **Findings merged:** 8
- **Packages:** apps/desktop, apps/fixture-recorder, packages/cli, packages/plugin-embeddings-openai, packages/plugin-embeddings-transformers, packages/plugin-stt-whisper-codex, packages/sdk

**What / why:** Skeleton/dormant features and unreachable UI (wasm authoring path, reasoning-effort dead UI, paused-run mishandling) that need a product decision: finish or remove. (8 deduped findings.)

**Rationale / risk:** Each needs a finish-or-remove call; not a pure refactor. Propose-only.

<details><summary>8 merged findings (file — title)</summary>

- `apps/desktop/src/settings/ProvidersTab.tsx` [u11-2/medium] Reasoning-effort UI is unreachable + localStorage round-trip is dormant plumbing
- `apps/desktop/src/settings/ProvidersTab.tsx` [incomplete-1/medium] Desktop per-provider reasoning-effort control is a dead UI: persists to localStorage, runner never reads it
- `apps/fixture-recorder/src/index.ts` [u18-2/low] --max-iterations silently drops non-numeric input instead of validating
- `packages/cli/src/commands/prompt.ts` [u23-4/low] --output-format value is cast, not validated; unknown values silently fall through to JSON
- `packages/plugin-embeddings-openai/src/embedder.ts` [u83-2/low] dimensions override silently accepted for ada-002, which the API does not support
- `packages/plugin-embeddings-transformers/src/embedder.ts` [u84-5/low] No batching/bound on embed() input — whole corpus sent to onnx in one call
- `packages/plugin-stt-whisper-codex/src/transcriber.ts` [u107-2/low] TranscribeOptions.language/prompt silently dropped; result omits language/duration/segments
- `packages/sdk/src/provider-utils.ts` [u124-3/low] zodToJsonSchema silently drops value schema for ZodRecord/ZodTuple/ZodAny (unhandled types)

</details>

---

## TECH_DEBT.md items retirable by this work

- TECH_DEBT.md 'Browser surface reverted from CDP screencast' dormant-debt entry (lines 140-151)
- TECH_DEBT.md 2026-06-17 'Skills gallery reimplements the shared settings SearchBox' (L40-51)
- TECH_DEBT.md L878-884 (desksStore/sessionsStore consolidation)
- A41 (follow-on: the re-index was fixed but the recall-time scan stayed serial)

Beyond the explicitly-tagged entries, this sweep also re-validates and gives execution plans for the standing TECH_DEBT themes: the desksStore/sessionsStore consolidation, the dormant CDP-screencast removal, the SkillGallery SearchBox dup, the missing `writeFileAtomicSync`, and the under-tested chatStore / SurfaceHost / runner-surface subsystems. Per the TECH_DEBT-journal rule, each executed cluster should retire its matching journal entry and log any newly-discovered debt in the same PR.

## Suggested execution order

1. **Tier-1 dead-code + dup removals first** (`t1-deadcode-screencast`, `t1-deadcode-oneref`, `t1-searchbox-dup`, `t1-blockshared-dup`, `t1-compareSemver-dup`) — they shrink the god-files and remove noise before the structural work.
2. **Tier-1 type-safety + leak fixes** (`t1-types-casts`, `t1-leak-timers-listeners`, `t1-runner-completedturns-leak`, `t1-workflow-reducer-exhaustive`, `t1-fakeprovider-bugs`).
3. **Tier-2 shared-helper extractions** (`t2-json-store-block`, `t2-writefileatomicsync`, `t2-active-def-registry`, `t2-openai-compat-factory`, `t2-oneshot-stream-helper`) — build the tested primitives, then migrate callers.
4. **Tier-2 mutex/atomicity + perf** (`t2-mutex-rmw-stores`, `t2-chatmodel-fold-perf`, `t2-eventlog-elision-scans`, `t2-perf-quadratic-misc`) — guarded by the new helpers + golden tests.
5. **Tier-2 confirmed bug batches** (`t2-security-correctness`, `t2-security-correctness-2`, `t2-oauth-token-races`, `t2-embedding-correctness`, `t2-lifecycle-shutdown`, `t2-confirmed-logic-bugs`, `t2-more-logic-bugs`) — each fix + regression test.
6. **Tier-3** (`t3-god-files`, `t3-test-harness`) as sustained tracks; long-tail buckets opportunistically per file.

