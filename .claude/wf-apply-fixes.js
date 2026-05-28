export const meta = {
  name: 'moxxy-apply-fixes',
  description: 'Apply the safe high-value audit fixes: consume new SDK primitives + security/correctness/conformance fixes, one agent per disjoint package set',
  phases: [{ title: 'Fix', detail: '18 agents, disjoint package ownership, parallel edits' }],
}

const PREAMBLE = [
  'You are fixing code-quality audit findings in the moxxy monorepo (working dir /Users/maqsiak/personal/blocky), on branch refactor/code-quality-sweep.',
  '',
  "A foundation of NEW shared helpers was just added to @moxxy/sdk and is ALREADY BUILT. Import them from '@moxxy/sdk':",
  '- writeFileAtomic(target, data, opts?) — opts { mode?, encoding? }. Crash-atomic whole-file write (mkdir parents, write unique tmp, rename over target). Use for EVERY whole-file write. Replaces any hand-rolled `const tmp=...; await fs.writeFile(tmp,...); await fs.rename(tmp,target)` AND any in-place fs.writeFile/writeFileSync of a whole file. Pass { mode: 0o600 } for secret files.',
  '- moxxyHome(): string and moxxyPath(...segments): string — resolve `$MOXXY_HOME ?? ~/.moxxy`. Replace EVERY inline `path.join(os.homedir(), \'.moxxy\', ...)` and `process.env.MOXXY_HOME ?? join(homedir(), \'.moxxy\')`.',
  '- createMutex(): { run<T>(fn): Promise<T> } — per-instance write mutex (serializes async mutators; survives rejections). Replace hand-rolled writeChain/serialize/mutate promise-chains, and ADD one where a read-modify-write store currently has no serialization.',
  '- estimateTextTokens(text): number — chars/4. Replace hardcoded `Math.ceil(text.length / 4)` in provider countTokens fallbacks.',
  '- createStuckLoopDetector({ windowSize?, repeatThreshold? }) and stableHash(input): string — repeated-tool-call detection + key-order-canonical input hash, for modes.',
  '- readRequestBody(req, maxBytes): Promise<Buffer> (size-guarded) and bearerTokenMatches(presented, expected): boolean (constant-time) — for HTTP listeners.',
  '- The PermissionResolver factories (createAllowListResolver, denyByDefaultResolver, createDeferredPermissionResolver, createCallbackResolver, autoAllowResolver) now live in @moxxy/sdk (still re-exported from @moxxy/core for back-compat). Plugins MUST import them from \'@moxxy/sdk\'.',
  '- Error classification (already in SDK): MoxxyError, classifyHttpStatus(status), classifyNetworkError(err), toFriendlyError(err, { provider?, url? }).',
  '',
  'RULES:',
  '- Edit ONLY the package(s) assigned to you below. Never touch another package, @moxxy/sdk, or @moxxy/core (unless core IS your assignment).',
  '- Behavior-preserving. Keep the same observable behavior and public API unless a finding explicitly says to change it. Match surrounding style; add a comment only where the WHY is non-obvious.',
  '- Do NOT run repo-wide builds (`pnpm build`, `turbo`) or any git command. You MAY run `pnpm --filter <your-package> test` once to sanity-check, but it is optional and may fail for unrelated reasons — do not chase unrelated failures.',
  '- DEFERRED — do NOT do these even if you notice them (list under `blocked` instead): changing the ClientSession/SessionLike contract or any `session as unknown as {...}` cast; changing hardcoded definePlugin `version` literals; changing moxxy.plugin manifest `kind`; introducing a shared HTTP-server base class or a runSingleShotTurn mode-helper or a shared tunnel-spawn helper (those are tracked separately).',
  '- If a fix is riskier than it first looks, or you cannot do it safely/cleanly, DO NOT force it — list it under `blocked` with a one-line reason.',
  '- Read the files before editing. Be precise and minimal.',
  '',
  'Return the structured result.',
].join('\n')

const RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    agent: { type: 'string' },
    packages: { type: 'array', items: { type: 'string' } },
    changes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: { file: { type: 'string' }, summary: { type: 'string' } },
        required: ['file', 'summary'],
      },
    },
    blocked: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: { item: { type: 'string' }, reason: { type: 'string' } },
        required: ['item', 'reason'],
      },
    },
    testsRun: { type: 'string', description: 'command + pass/fail, or "none"' },
    notes: { type: 'string' },
  },
  required: ['agent', 'packages', 'changes', 'blocked', 'testsRun', 'notes'],
}

const TASKS = [
  {
    label: 'core-callsites',
    task: [
      'ASSIGNED PACKAGE: packages/core ONLY.',
      'Replace hand-rolled crash-atomic writes with writeFileAtomic from @moxxy/sdk in: core/src/usage-stats.ts (~line 65, currently the collision-prone `${path}.${pid}.tmp` scheme), core/src/preferences.ts (~line 59, same collision-prone scheme), core/src/permissions/engine.ts persist() (~line 131), core/src/sessions/persistence.ts writeJsonAtomic (~line 283). Where the local helper (e.g. writeJsonAtomic) is called in several places, keep the helper but reimplement its body as `await writeFileAtomic(target, JSON.stringify(value, null, 2))` (preserve current JSON formatting), or replace call sites directly — your choice, minimal diff.',
      'Replace the hand-rolled `private serialize<T>` / writeChain promise-chain in core/src/permissions/engine.ts with a `createMutex()` instance (hold `private mutex = createMutex()`, call `this.mutex.run(() => ...)`). Keep identical semantics. Also check core/src/sessions/persistence.ts writeQueue — if it is the same promise-chain mutex pattern, convert it to createMutex too.',
      'core/src/usage-stats.ts mergeUsageStats: if it does an unguarded read-modify-write of the stats file, wrap the read-modify-write in a module-level or instance createMutex so concurrent merges cannot clobber. If it is already only called serially, note that under blocked instead of forcing a change.',
      'core is allowed to import from @moxxy/sdk. Do not change public exports.',
    ].join('\n'),
  },
  {
    label: 'vault',
    task: [
      'ASSIGNED PACKAGE: packages/plugin-vault ONLY.',
      'Adopt SDK helpers: replace the hand-rolled tmp+rename in store.ts (~line 159) with writeFileAtomic (pass { mode: 0o600 } since this is a secret store). Replace the hand-rolled serialize/writeChain (~line 165) with createMutex. Replace inline `~/.moxxy` resolution in index.ts (~line 30) and keysource.ts (~line 102) with moxxyHome()/moxxyPath() — note this FIXES a real bug where vault ignored MOXXY_HOME.',
      'keysource.ts persists the disk key cache — ensure that write is also atomic with mode 0o600 via writeFileAtomic.',
      'Do NOT add the new keysource/canary test suites (deferred). Keep behavior identical.',
    ].join('\n'),
  },
  {
    label: 'memory',
    task: [
      'ASSIGNED PACKAGE: packages/plugin-memory ONLY.',
      'Adopt SDK helpers: writeFileAtomic in store/io.ts (~line 36) and embedding-cache.ts (~line 104, currently non-atomic). createMutex to replace the hand-rolled writeChain (store.ts ~line 56). moxxyHome()/moxxyPath() instead of inline `~/.moxxy` (store.ts ~line 46).',
      'SECURITY FIX (high): recall() mutates the shared embedding index (load/set/prune/flush in store.ts ~169-183 and store/search.ts recallVector ~29-53) OUTSIDE the write mutex, so concurrent recalls or a recall racing forget() clobber the cache. Wrap the index load->set->prune->flush sequence of recallVector in the same mutex (this.mutex.run(...)). The pure cosine ranking can stay outside the lock. Make sure save/update/forget still run under the mutex too.',
    ].join('\n'),
  },
  {
    label: 'mcp',
    task: [
      'ASSIGNED PACKAGE: packages/plugin-mcp ONLY.',
      'Adopt SDK helpers: writeFileAtomic in admin/config-io.ts (~line 35) and admin/skill.ts (~line 58, currently non-atomic). moxxyHome()/moxxyPath() instead of inline `~/.moxxy` in admin/config-io.ts (~line 14) and admin/index.ts (~line 57).',
      'Add a createMutex around the read-modify-write config cycle (admin/config-io.ts add/remove, admin/runtime.ts ~134) so concurrent mcp_add_server/mcp_remove_server cannot clobber the config file.',
      'SECURITY: mcp_test_server (admin/tools/test.ts) spawns arbitrary MCP server processes but declares NEITHER a `permission` NOR `isolation`. Add `permission: { action: \'prompt\' }` to mirror its sibling install_plugin, and an honest `isolation: { capabilities: { subprocess: true, ... } }` block modeled on packages/tools-builtin/src/bash.ts.',
      'CONFORMANCE: admin/config-io.ts readConfig does `JSON.parse(raw) as McpStoredConfig` with only a shallow Array.isArray check. If a zod schema for the config already exists in the package, validate with safeParse and discard/repair on failure (mirror plugin-scheduler/plugin-webhooks). If no schema exists, add a minimal one. Wrap the 8 `throw new Error` in src in MoxxyError with sensible codes where they are user-facing.',
    ].join('\n'),
  },
  {
    label: 'scheduler+webhooks',
    task: [
      'ASSIGNED PACKAGES: packages/plugin-scheduler and packages/plugin-webhooks ONLY.',
      'Both: replace hand-rolled tmp+rename with writeFileAtomic (scheduler store.ts ~207, runner.ts ~66; webhooks store.ts ~260, config.ts ~95, runner.ts ~65). Replace the hand-rolled mutate()/writeChain mutex with createMutex. Replace the inline `process.env.MOXXY_HOME ?? join(homedir(),\'.moxxy\')` with moxxyHome()/moxxyPath() (scheduler store.ts ~83 + runner.ts ~41; webhooks store.ts ~129 + config.ts ~41 + runner.ts ~37).',
      'webhooks HTTP listener: replace the hand-rolled readBody loop in server.ts (~200-218) with readRequestBody(req, maxBytes) from @moxxy/sdk, and the bearer-token branch in verify.ts (~54-62) with bearerTokenMatches from @moxxy/sdk. Preserve the existing max-size and signature semantics.',
      'Remove the spurious `@moxxy/core` dependency from BOTH package.json files (verified: zero `@moxxy/core` imports in src — confirm with grep before removing).',
    ].join('\n'),
  },
  {
    label: 'provider-admin',
    task: [
      'ASSIGNED PACKAGE: packages/plugin-provider-admin ONLY.',
      'Adopt SDK helpers: writeFileAtomic in store.ts (~line 33, currently collision-prone `${path}.${pid}.tmp`). moxxyHome()/moxxyPath() instead of inline `~/.moxxy` (store.ts ~12). Add createMutex around upsertStoredProvider/remove read-modify-write (store.ts ~38-46) which currently has NO serialization.',
      'CONFORMANCE: store.ts readProvidersConfig (~18) does `JSON.parse(raw) as unknown` + shallow Array.isArray. Validate with a zod schema (.safeParse, discard on failure). Add the schema if absent.',
      'DRY: factory.ts validateOpenAICompatKey (~35-49) duplicates provider-openai. provider-openai will export `validateOpenAICompatKey` (a DI-friendly OpenAI-compatible key validator). Import and use it from \'@moxxy/plugin-provider-openai\' instead of the local copy, deleting the local duplicate. (If that import is not yet exported when you build, that is expected — another agent adds the export; just write the import.) Wrap user-facing `throw new Error` in MoxxyError.',
    ].join('\n'),
  },
  {
    label: 'self-update+config+tools-builtin',
    task: [
      'ASSIGNED PACKAGES: packages/plugin-self-update, packages/config, packages/tools-builtin ONLY.',
      'self-update: writeFileAtomic in transaction.ts (~143-144) and core-update.ts (~187), replacing the static `${file}.tmp` scheme. moxxyHome()/moxxyPath() if it inlines ~/.moxxy.',
      'config: writeFileAtomic in plugin.ts (~174 and ~228) replacing the in-place writes.',
      'tools-builtin (HIGH SECURITY): write.ts (~29) and edit.ts (~45) call `await fs.writeFile(resolved, ..., \'utf8\')` IN PLACE — a crash/abort mid-write corrupts the user file. Replace both with writeFileAtomic(resolved, content) from @moxxy/sdk. Also add an abort check: if ctx provides an AbortSignal and it is already aborted before the write, throw/return without writing (look at how other tools-builtin handlers read the signal; if none do, skip the abort part and note it). Wrap user-facing `throw new Error` in tools-builtin handlers in MoxxyError with sensible codes (there are ~11). Keep the Edit pre-read/uniqueness checks intact.',
    ].join('\n'),
  },
  {
    label: 'providers',
    task: [
      'ASSIGNED PACKAGES: packages/plugin-provider-anthropic, packages/plugin-provider-openai, packages/plugin-provider-openai-codex ONLY.',
      'All three: in the countTokens fallback, replace the hardcoded `Math.ceil(blob.length / 4)` (anthropic provider.ts ~215, openai provider.ts ~222, codex provider.ts ~117) with estimateTextTokens(blob) from @moxxy/sdk.',
      'codex provider.ts (~100): replace `retryable: response.status >= 500 || response.status === 429` with the SDK classifyHttpStatus(response.status) (use its retryable verdict / wrap in MoxxyError) so the retryable flag is consistent.',
      'codex oauth.ts (~38-58): it hand-rolls base64UrlEncode/randomString/generatePKCE/generateState that duplicate plugin-oauth. plugin-oauth will export generateCodeVerifier, computeCodeChallenge, generateState from its public entry. Import those from \'@moxxy/plugin-oauth\' and delete the local PKCE/state helpers, keeping behavior identical (verifier -> S256 challenge). (If the import is not yet exported at build time, that is expected — the oauth agent adds it.)',
      'provider-openai: EXPORT a DI-friendly OpenAI-compatible key validator named `validateOpenAICompatKey` from the package entry (it already has validateKey with ValidateKeyDeps in validate.ts — export it under that name, or add a thin named re-export). Another package will import it.',
    ].join('\n'),
  },
  {
    label: 'channels',
    task: [
      'ASSIGNED PACKAGES: packages/plugin-channel-http, packages/plugin-channel-web, packages/plugin-cli, packages/plugin-telegram ONLY.',
      'INVARIANT FIX: channel-http/src/channel.ts and channel-web/src/channel.ts import resolver factories (createAllowListResolver, denyByDefaultResolver) from \'@moxxy/core\' — a plugin must import only from \'@moxxy/sdk\'. Change those imports to \'@moxxy/sdk\'. Then for EACH of the 4 channel packages: grep its src for `@moxxy/core`; if the ONLY remaining core usage was the resolver factories, also remove `@moxxy/core` from that package.json dependencies. If the package still legitimately imports other core symbols (Session, runTurn, etc. — likely for cli and telegram), just fix the resolver import and LEAVE the dep. Also repoint any createDeferredPermissionResolver import (plugin-cli/src/resolver.ts) from \'@moxxy/core\' to \'@moxxy/sdk\'.',
      'DRY: channel-http/src/router.ts readBody/readBodyBytes (~55-77) and checkAuth constant-time bearer compare (~46-53) — replace with readRequestBody and bearerTokenMatches from @moxxy/sdk. channel-web/src/channel.ts token gate (~84,221) — use bearerTokenMatches.',
      'channel-web/src/tunnel-settings.ts (~44): replace writeFileSync with writeFileAtomic. moxxyHome()/moxxyPath() for any inline ~/.moxxy in these packages.',
      'DEFERRED — DO NOT TOUCH: the `session as unknown as { readyProviders | credentialResolver | mcpAdmin }` casts in plugin-cli (run-slash.ts, picker-handlers.ts, use-mcp-status.ts) and plugin-telegram (callback-handler.ts, slash-handler.ts). List them under blocked.',
      'NOTE: plugin-cli has uncommitted WIP in src/index.ts and src/voice-input.ts, and plugin-browser is owned by another agent. Avoid editing plugin-cli/src/index.ts and voice-input.ts unless strictly required for your task (it is not).',
    ].join('\n'),
  },
  {
    label: 'oauth',
    task: [
      'ASSIGNED PACKAGE: packages/plugin-oauth ONLY.',
      'EXPORT the PKCE helpers from the package public entry (index.ts): generateCodeVerifier, computeCodeChallenge, generateState (they live in src/pkce.ts). Another package imports them.',
      'CONFORMANCE: route non-OK HTTP responses through classifyHttpStatus and wrap thrown errors in MoxxyError instead of `throw new Error(\\`HTTP ${res.status}\\`)` in token-exchange.ts (~30,64), device-flow.ts (~38), openai-device-flow.ts (~64,134), rfc8628-device-flow.ts (~47,96). There are ~20 plain throws; convert the user-facing/network ones to MoxxyError with appropriate codes.',
      'DRY (attempt, moderate risk): device-flow.ts runDeviceCodeFlow (~29-125) duplicates adapters/rfc8628-device-flow.ts (~30-112). If you can collapse the legacy runDeviceCodeFlow onto the rfc8628 adapter WITHOUT breaking tools.ts callers or existing tests, do so. If it is too entangled to do safely, leave it and list under blocked. moxxyHome()/moxxyPath() for inline ~/.moxxy.',
    ].join('\n'),
  },
  {
    label: 'modes',
    task: [
      'ASSIGNED PACKAGES: packages/mode-tool-use, packages/mode-plan-execute, packages/mode-developer, packages/mode-bmad, packages/mode-deep-research ONLY.',
      'mode-tool-use: createStuckLoopDetector and stableHash now live in @moxxy/sdk. Delete the local src/stuck-loop-detector.ts implementation and re-export/import from \'@moxxy/sdk\' instead. Update its imports and its test file (if the test imports from the local path, point it at the SDK or keep a thin re-export module).',
      'mode-plan-execute (BUG): execute-phase.ts signatureFor (~192-194) uses non-canonical `JSON.stringify(input ?? null)` which misses key-reordered repeats. Replace with stableHash from @moxxy/sdk (or adopt createStuckLoopDetector for the whole window/threshold logic).',
      'mode-developer: replace the verbatim stableInput/canonicalize copy (verify-phase.ts ~132-180) with stableHash/createStuckLoopDetector from @moxxy/sdk. HIGH FIX: developer-loop.ts runGitCommit (~254-356) hand-rolls permission/execute/result and SKIPS ctx.hooks.dispatchToolCall (the contract says dispatchToolCall is the one place that runs hooks before the permission check). Replace the hand-rolled block with: emit tool_call_requested, then `yield* dispatchToolCall(ctx, { id: String(callId), name: \'Bash\', input: bashInput }, 0)`, then emit the developer_commit_created plugin_event based on whether the last tool_result for callId was ok. Remove the now-false comment claiming it goes through the same hooks.',
      'mode-bmad (HIGH FIX): phases/implementation-messages.ts (~79-103) and phases/collect.ts buildBaseMessages hand-roll a `for (const e of ctx.log.slice())` projection, bypassing projectMessages and thus losing compaction/elision/orphan-synthesis. Replace with projectMessages(ctx, { systemPrompt }) from @moxxy/sdk; express the BMAD context/devNudge injection via the opts.trailingUserText slot or by appending to the returned messages.',
      'mode-deep-research: add runElisionIfNeeded(ctx) before building messages in query-phase.ts and synthesis-phase.ts (every sibling mode does this). Add a moxxy.requirements entry for @moxxy/plugin-subagents to package.json (it hard-depends on ctx.subagents at runtime, research-loop.ts ~53) mirroring plugin-stt-whisper-codex package.json moxxy.requirements format, so the loader fails fast.',
    ].join('\n'),
  },
  {
    label: 'isolators+security',
    task: [
      'ASSIGNED PACKAGES: packages/isolator-wasm, packages/isolator-worker, packages/isolator-subprocess, packages/plugin-security ONLY.',
      'HIGH SECURITY FIX: isolator-wasm/src/index.ts (~391) broker_exec calls `spawnSync(command, [...argv], { cwd, encoding: \'utf8\' })` with NO env, leaking the entire host process.env (every API key/token/secret) to the child. plugin-security/src/broker.ts has buildBrokerEnv(caps, env?) (~303-356) that curates a minimal env. EXPORT buildBrokerEnv from plugin-security (public entry) if not already exported, import it in isolator-wasm, and pass `env: buildBrokerEnv(caps, undefined)` to spawnSync. Also surface caps.timeMs as the spawnSync `timeout` option. Verify worker/subprocess isolators already curate env (they use the async broker) — if any also leaks, fix the same way.',
    ].join('\n'),
  },
  {
    label: 'browser',
    task: [
      'ASSIGNED PACKAGE: packages/plugin-browser ONLY.',
      'HIGH SECURITY FIX: browser-session.ts (~32) the goto action schema uses `z.string().url()` which accepts file:// and javascript: URLs forwarded to Playwright page.goto. Add `.refine((u) => /^https?:\\/\\//i.test(u), \'only http(s) URLs allowed\')` to the goto url field. Mirror the scheme check that web_fetch already uses (assertPublicUrl). Optionally add a defence-in-depth check in sidecar/dispatch.ts case \'goto\'.',
      'SECURITY: browser_session (browser-session.ts ~270) spawns Playwright via child_process but declares no `isolation` capabilities. Add an honest `isolation: { capabilities: { subprocess: true, net: { mode: \'any\' }, ... } }` block modeled on packages/tools-builtin/src/bash.ts. Keep the existing `permission: { action: \'prompt\' }`.',
      'CONFORMANCE: wrap user-facing `throw new Error` (there are ~8) in MoxxyError with codes where appropriate.',
      'NOTE: plugin-browser/src/index.ts has uncommitted WIP — avoid editing index.ts unless strictly required (the goto/isolation fixes are in browser-session.ts). If you must, make a minimal additive change only.',
    ].join('\n'),
  },
  {
    label: 'runner',
    task: [
      'ASSIGNED PACKAGE: packages/runner ONLY.',
      'BUG FIX: server.ts (~158-161) on attach replays `this.session.log.slice(since)` whose events keep their original seq, but the client mirror is a fresh EventLog whose ingest only accepts `event.seq === events.length` (contiguous from 0). So any sinceSeq>0 attach silently drops every event and the mirror desyncs. Implement the cheap, correct fix (option a): always replay from 0 into a fresh mirror (ignore/remove the sinceSeq replay-into-empty-mirror path), matching the only tested path (connectRemoteSession default sinceSeq=0). Keep the wire protocol compatible. ADD a regression test that attaches with sinceSeq>0 (or documents that replay is always full) and asserts the mirror is fully populated and stays in sync.',
    ].join('\n'),
  },
  {
    label: 'marketplace+plugins-admin',
    task: [
      'ASSIGNED PACKAGES: packages/plugin-marketplace, packages/plugin-plugins-admin ONLY.',
      'BUG: plugin-marketplace has NO src/ tracked in git — only dist/. The dist imports installPluginPackage, removePluginPackage, userPluginsDir from @moxxy/plugin-plugins-admin, but plugin-plugins-admin currently exports only buildInstallPluginTool and buildPluginsAdminPlugin, so a clean rebuild fails. FIX: (1) read packages/plugin-marketplace/dist to understand what the package does, then WRITE clean idiomatic src/*.ts that compiles to the same behavior; (2) realign plugin-plugins-admin to export the imperative helpers the marketplace needs (installPluginPackage, removePluginPackage, userPluginsDir) — these likely already exist internally; export them from the entry. Ensure plugin-marketplace package.json has a build script + tsconfig consistent with sibling plugins. If reconstructing src cleanly is not feasible from dist, do NOT guess — instead document precisely under blocked what is needed.',
      'SECURITY: plugin-plugins-admin install_plugin (install.ts ~69) spawns npm but declares no `isolation` capabilities and its subprocess ignores ctx.signal. Add an honest `isolation: { capabilities: { subprocess: true, net: { mode: \'any\' }, fs: {...} } }` block (model on tools-builtin/src/bash.ts) and forward ctx.signal to the spawn if feasible.',
      'Use moxxyHome()/moxxyPath() for any inline ~/.moxxy (userPluginsDir).',
    ].join('\n'),
  },
  {
    label: 'stt-whisper',
    task: [
      'ASSIGNED PACKAGE: packages/plugin-stt-whisper ONLY (do NOT touch plugin-stt-whisper-codex — it is the correct reference).',
      'HIGH FIX: whisper.ts (~59-107) WhisperTranscriber.transcribe ignores opts.signal, so a turn abort cannot cancel an in-flight OpenAI upload. Pass `signal: opts.signal` to both this.client.audio.transcriptions.create() call sites (verbose_json and plain branches), matching how plugin-stt-whisper-codex/src/transcriber.ts (~70) threads it.',
      'CONFORMANCE: bring error handling to parity with the codex sibling — classify network/HTTP failures (classifyNetworkError/classifyHttpStatus) and wrap thrown errors in MoxxyError instead of plain Error.',
    ].join('\n'),
  },
  {
    label: 'computer-control',
    task: [
      'ASSIGNED PACKAGE: packages/plugin-computer-control ONLY.',
      'CONFORMANCE: wrap the ~14 user-facing `throw new Error(...)` in MoxxyError with sensible stable codes (e.g. a platform/tool error code), so failures carry classifiable codes like the rest of the framework. Keep messages and behavior identical otherwise. Do not change the macOS native-input logic.',
    ].join('\n'),
  },
  {
    label: 'subagents+view',
    task: [
      'ASSIGNED PACKAGES: packages/plugin-subagents, packages/plugin-view ONLY.',
      'CONFORMANCE: plugin-subagents dispatch-agent.ts (~91-93) throws plain Error for the no-spawner case — wrap in MoxxyError with a sensible code.',
      'Remove the spurious `@moxxy/core` dependency from BOTH package.json files if present (verified: zero `@moxxy/core` imports in src — confirm with grep before removing; both currently list it, plugin-view as devDep, plugin-subagents as devDep).',
    ].join('\n'),
  },
]

phase('Fix')
const results = (await parallel(
  TASKS.map((t) => () => agent(`${PREAMBLE}\n\n=== YOUR TASK ===\n${t.task}`, { label: t.label, phase: 'Fix', schema: RESULT_SCHEMA })),
)).filter(Boolean)

return { results }
