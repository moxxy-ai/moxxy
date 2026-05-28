export const meta = {
  name: 'moxxy-quality-audit',
  description: 'Plugin-by-plugin code-quality audit of the moxxy monorepo (abstractions, DRY/KISS/SOLID, security-by-default, tests, readability)',
  phases: [
    { title: 'Map', detail: 'catalog SDK/core contracts + shared helpers as the reference' },
    { title: 'Analyze', detail: 'one reviewer per package/cluster; score + structured findings' },
    { title: 'Cross-cut', detail: 'cross-package duplication to hoist + contract-conformance gaps' },
  ],
}

const SCORES = {
  type: 'object',
  additionalProperties: false,
  properties: {
    abstractions: { type: 'integer', minimum: 1, maximum: 5 },
    dry: { type: 'integer', minimum: 1, maximum: 5 },
    kiss: { type: 'integer', minimum: 1, maximum: 5 },
    solid: { type: 'integer', minimum: 1, maximum: 5 },
    security: { type: 'integer', minimum: 1, maximum: 5 },
    tests: { type: 'integer', minimum: 1, maximum: 5 },
    readability: { type: 'integer', minimum: 1, maximum: 5 },
  },
  required: ['abstractions', 'dry', 'kiss', 'solid', 'security', 'tests', 'readability'],
}

const FINDING = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { type: 'string' },
    principle: { type: 'string', enum: ['DRY', 'KISS', 'SOLID', 'Security', 'Tests', 'Readability', 'Abstraction'] },
    severity: { type: 'string', enum: ['high', 'medium', 'low'] },
    location: { type: 'string', description: 'file:line or file' },
    problem: { type: 'string', description: 'what is wrong, concretely' },
    fix: { type: 'string', description: 'concrete refactor that resolves it' },
    risk: { type: 'string', enum: ['mechanical', 'moderate', 'design-change'] },
  },
  required: ['title', 'principle', 'severity', 'location', 'problem', 'fix', 'risk'],
}

const PACKAGE_REPORT = {
  type: 'object',
  additionalProperties: false,
  properties: {
    package: { type: 'string' },
    role: { type: 'string', description: 'which SDK contract / framework role it fills' },
    summary: { type: 'string', description: '2-4 sentence overall health verdict' },
    scores: SCORES,
    findings: { type: 'array', items: FINDING },
    exemplary: { type: 'array', items: { type: 'string' }, description: 'patterns done well, worth keeping/propagating' },
  },
  required: ['package', 'role', 'summary', 'scores', 'findings', 'exemplary'],
}

phase('Map')
const contracts = await agent(
  [
    'You are mapping the contract surface of the moxxy framework so 35 downstream reviewers can judge whether each package conforms to and properly composes the shared abstractions. Working dir: /Users/maqsiak/personal/blocky.',
    '',
    'Read the contract/interface files in packages/sdk/src (especially: provider.ts, provider-utils.ts, mode.ts, mode-helpers.ts, compactor.ts, compactor-helpers.ts, cache-strategy.ts, channel.ts, isolation.ts, tool.ts, tool-dispatch.ts, tool-gating.ts, plugin.ts, define.ts, embedding.ts, embedding-cache.ts, permission.ts, transcriber.ts, session-like.ts, hooks.ts, events.ts, errors.ts, requirements.ts, install-hints.ts, schemas.ts) and skim packages/core/src to see how registries, plugin host, session, and permissions wire these up.',
    '',
    'Produce a CONCISE markdown reference (target 400-700 lines max) that downstream reviewers will be handed verbatim. For each contract/interface include: its exact name, the shape (key methods/fields with signatures), what a conforming implementation MUST do, and the shared SDK helper(s) implementations are expected to reuse instead of reinventing (e.g. collectProviderStream, projectMessagesFromLog, isRetryableError, zodToJsonSchema, CachedEmbeddingProvider, mode-helpers, compactor-helpers, defineX factories). Also list the hard architectural invariants (sdk zero internal deps; core never imports a plugin; persist atomically; serialize file-state mutators; filter log subscribers by turnId; deny-by-default permissions). Be precise about signatures — this is the yardstick. Output ONLY the markdown reference, no preamble.',
  ].join('\n'),
  { label: 'contract-map', phase: 'Map' },
)

const UNITS = [
  { dirs: ['sdk'], label: 'sdk', role: 'typed public surface: every contract + shared helpers', tier: 'core' },
  { dirs: ['core'], label: 'core', role: 'runtime: event log, plugin host, registries, permissions, session, skill loader', tier: 'core' },
  { dirs: ['config', 'testing'], label: 'config+testing', role: 'config loader (zod) + FakeProvider/record-replay harness', tier: 'leaf' },
  { dirs: ['plugin-provider-anthropic'], label: 'provider-anthropic', role: 'LLMProvider', tier: 'core' },
  { dirs: ['plugin-provider-openai'], label: 'provider-openai', role: 'LLMProvider', tier: 'core' },
  { dirs: ['plugin-provider-openai-codex'], label: 'provider-codex', role: 'LLMProvider (ChatGPT OAuth, Responses API)', tier: 'core' },
  { dirs: ['plugin-provider-admin'], label: 'provider-admin', role: 'runtime registration of OpenAI-compatible providers', tier: 'leaf' },
  { dirs: ['mode-tool-use'], label: 'mode-tool-use', role: 'LoopStrategy (default Claude-Code-style)', tier: 'core' },
  { dirs: ['mode-plan-execute'], label: 'mode-plan-execute', role: 'LoopStrategy', tier: 'core' },
  { dirs: ['mode-developer'], label: 'mode-developer', role: 'LoopStrategy (implement/verify/commit)', tier: 'core' },
  { dirs: ['mode-bmad'], label: 'mode-bmad', role: 'LoopStrategy (multi-persona)', tier: 'leaf' },
  { dirs: ['mode-deep-research'], label: 'mode-deep-research', role: 'LoopStrategy (multi-query research)', tier: 'leaf' },
  { dirs: ['compactor-summarize', 'cache-strategy-stable-prefix'], label: 'compactor+cache', role: 'Compactor + CacheStrategy defaults', tier: 'core' },
  { dirs: ['plugin-security'], label: 'plugin-security', role: 'Isolator interface + none/inproc impls (security-by-default)', tier: 'core' },
  { dirs: ['isolator-worker', 'isolator-subprocess', 'isolator-wasm'], label: 'isolators', role: 'Isolator impls (worker/subprocess/wasm) — security boundary', tier: 'core' },
  { dirs: ['plugin-cli'], label: 'plugin-cli', role: 'Channel (Ink TUI) + interactive PermissionResolver (LARGE ~3.8k LOC)', tier: 'core' },
  { dirs: ['plugin-telegram'], label: 'plugin-telegram', role: 'Channel (TOFU pairing, ~2.9k LOC)', tier: 'core' },
  { dirs: ['plugin-channel-http'], label: 'channel-http', role: 'Channel (HTTP, auth + allow-list)', tier: 'leaf' },
  { dirs: ['plugin-channel-web'], label: 'channel-web', role: 'Channel (web UI)', tier: 'leaf' },
  { dirs: ['plugin-embeddings-openai', 'plugin-embeddings-transformers'], label: 'embeddings', role: 'EmbeddingProvider (should reuse CachedEmbeddingProvider)', tier: 'leaf' },
  { dirs: ['plugin-stt-whisper', 'plugin-stt-whisper-codex'], label: 'stt-whisper', role: 'Transcriber (two variants — DRY between them is key)', tier: 'leaf' },
  { dirs: ['plugin-memory'], label: 'plugin-memory', role: 'memory journal + TF-IDF/vector recall', tier: 'core' },
  { dirs: ['plugin-vault'], label: 'plugin-vault', role: 'encrypted secret store (AES-256-GCM + keytar) — security-sensitive', tier: 'core' },
  { dirs: ['plugin-oauth'], label: 'plugin-oauth', role: 'OAuth 2.0 + PKCE/device-code — security-sensitive', tier: 'core' },
  { dirs: ['tools-builtin'], label: 'tools-builtin', role: 'Read/Edit/Write/Bash/Grep/Glob tools', tier: 'core' },
  { dirs: ['plugin-commands', 'plugin-subagents'], label: 'commands+subagents', role: 'built-in slash commands + typed subagent dispatch', tier: 'leaf' },
  { dirs: ['plugin-mcp'], label: 'plugin-mcp', role: 'MCP server bridge', tier: 'leaf' },
  { dirs: ['plugin-scheduler'], label: 'plugin-scheduler', role: 'cron/heartbeat time-driven prompts', tier: 'leaf' },
  { dirs: ['plugin-webhooks'], label: 'plugin-webhooks', role: 'external-event triggers (verified HTTP + tunnels)', tier: 'leaf' },
  { dirs: ['plugin-browser'], label: 'plugin-browser', role: 'web_fetch tool + Playwright sidecar', tier: 'leaf' },
  { dirs: ['plugin-computer-control'], label: 'computer-control', role: 'macOS native input (screenshot/click/type)', tier: 'leaf' },
  { dirs: ['plugin-self-update'], label: 'self-update', role: 'agent edits own plugins/skills + core — security-sensitive', tier: 'core' },
  { dirs: ['plugin-plugins-admin', 'plugin-marketplace', 'plugin-usage-stats', 'plugin-view'], label: 'admin-misc', role: 'plugin install/list + marketplace + usage stats + view-render', tier: 'leaf' },
  { dirs: ['runner'], label: 'runner', role: 'bare session runner + unix-socket JSON-RPC (RemoteSession)', tier: 'core' },
  { dirs: ['cli'], label: 'cli', role: 'the moxxy binary, wizard, doctor (LARGE ~8k LOC)', tier: 'core' },
]

phase('Analyze')
const reports = (await parallel(UNITS.map((u) => () => {
  const opts = { label: u.label, phase: 'Analyze', schema: PACKAGE_REPORT }
  if (u.tier === 'leaf') opts.model = 'sonnet'
  const paths = u.dirs.map((d) => 'packages/' + d).join(', ')
  const prompt = [
    'You are a senior reviewer auditing the moxxy package(s) at: ' + paths + ' (working dir /Users/maqsiak/personal/blocky). Framework role: ' + u.role + '.',
    '',
    "Here is the framework's CONTRACT REFERENCE — judge conformance and helper-reuse against it:",
    '<contracts>',
    contracts,
    '</contracts>',
    '',
    'Read the package src/*.ts (skip generated/dist) and its *.test.ts files. For LARGE packages, read the index/entry plus the largest and most central files thoroughly and skim the rest — do not run out of budget. Then judge it on these dimensions and produce a structured report:',
    '',
    '- Abstractions/contracts: does it implement/use the right SDK contract cleanly? Are its own internal interfaces well-drawn (clear seams, no leaky abstractions, dependency-inversion where it matters)? Is it as generic/reusable as it should be without over-engineering?',
    '- DRY: logic duplicated within the package, or logic that duplicates an SDK shared helper it should call instead (collectProviderStream, projectMessagesFromLog, isRetryableError, zodToJsonSchema, CachedEmbeddingProvider, mode-helpers, compactor-helpers, defineX factories, atomic-write/mutex utilities). Flag copy-paste between sibling files.',
    '- KISS: needless complexity, dead code, premature abstraction, functions doing too much, deep nesting.',
    '- SOLID: SRP violations (god files/functions), OCP (hardcoded switch where a registry/strategy fits — the framework prefers swappable registry-backed blocks), interface segregation, dependency inversion.',
    '- Security-by-default: does it default to the safe option? secrets never logged/returned in plaintext; permission engine not bypassed; atomic file writes (writeFile tmp then rename); per-instance mutex on read-modify-write stores; input validation; no command/path injection; deny-by-default.',
    '- Tests: coverage of the real contract plus edge cases plus failure paths, not just happy path. Are tests meaningful or trivial? Missing tests for security-critical paths?',
    '- Readability: naming, comment hygiene (WHY-only per repo convention — flag noise AND missing-why), function length, file organization.',
    '',
    'Score each dimension 1-5 (5 = exemplary, 3 = acceptable, 1 = poor). For findings, prefer concrete, actionable items with file:line, a precise problem statement, and a concrete fix; tag each with the principle, severity, and refactor risk (mechanical/moderate/design-change). Do NOT invent problems to pad the list — if the package is genuinely clean, say so with few/no findings and high scores. Be specific and terse. Also note 1-3 exemplary patterns worth propagating. If a package dir is empty/stub, report that with a single low-severity finding.',
  ].join('\n')
  return agent(prompt, opts)
}))).filter(Boolean)

phase('Cross-cut')
const compact = reports.map((r) => ({
  package: r.package,
  role: r.role,
  summary: r.summary,
  scores: r.scores,
  findings: (r.findings || []).map((f) => ({ title: f.title, principle: f.principle, severity: f.severity, location: f.location })),
}))
const compactJson = JSON.stringify(compact, null, 1)

const CROSSCUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    themes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string' },
          kind: { type: 'string', enum: ['DuplicationToHoist', 'ConformanceGap', 'InconsistentPattern', 'SecurityDefault', 'MissingAbstraction', 'TestGap'] },
          severity: { type: 'string', enum: ['high', 'medium', 'low'] },
          packages: { type: 'array', items: { type: 'string' } },
          evidence: { type: 'string', description: 'concrete files/symbols proving the pattern' },
          recommendation: { type: 'string', description: 'the cross-cutting refactor' },
          risk: { type: 'string', enum: ['mechanical', 'moderate', 'design-change'] },
        },
        required: ['title', 'kind', 'severity', 'packages', 'evidence', 'recommendation', 'risk'],
      },
    },
  },
  required: ['themes'],
}

const dupPrompt = [
  'You are doing a CROSS-PACKAGE duplication and missing-abstraction pass on the moxxy monorepo (working dir /Users/maqsiak/personal/blocky). Below are per-package quality reports from 35 reviewers:',
  '<reports>',
  compactJson,
  '</reports>',
  '',
  'Your job: find logic DUPLICATED ACROSS packages that should be hoisted into @moxxy/sdk (or a shared util), and MISSING ABSTRACTIONS where several packages reinvent the same thing instead of a contract. Use grep/read to CONFIRM each claim with real symbols — do not rely on the reports alone. Likely hotspots to verify: HTTP server/auth/allow-list shared between plugin-channel-http, plugin-webhooks, plugin-channel-web; OAuth/token-refresh shared between plugin-oauth, provider-codex, stt-whisper-codex; provider streaming/retry across the 3 providers; atomic-write + per-instance mutex across vault/memory/permissions/oauth; tunnel logic; the two embeddings impls vs CachedEmbeddingProvider; the two stt impls; mode boilerplate across the 5 modes. For each real theme give concrete evidence (files/symbols) and the specific hoist/refactor. Return only confirmed, high-value themes.',
].join('\n')

const confPrompt = [
  'You are doing a CROSS-PACKAGE consistency, contract-conformance and security-default pass on the moxxy monorepo (working dir /Users/maqsiak/personal/blocky). Below are per-package quality reports from 35 reviewers:',
  '<reports>',
  compactJson,
  '</reports>',
  '',
  'Your job: find SYSTEMIC inconsistencies and conformance gaps — places where packages filling the SAME contract (the 3 providers; the 5 modes; the 4 channels cli/telegram/http/web; the 3 isolators; the 2 embedders; the 2 transcribers) diverge in shape, error handling, naming, defineX usage, or lifecycle-hook wiring when they should be uniform; and security defaults inconsistent across the codebase (one store writes atomically and mutexes, another does not; one channel deny-by-default, another not; secrets handled inconsistently). Use grep/read to CONFIRM with real symbols. For each theme give concrete evidence and the specific unifying refactor. Return only confirmed, high-value themes.',
].join('\n')

const crosscut = (await parallel([
  () => agent(dupPrompt, { label: 'crosscut:duplication', phase: 'Cross-cut', schema: CROSSCUT_SCHEMA }),
  () => agent(confPrompt, { label: 'crosscut:conformance', phase: 'Cross-cut', schema: CROSSCUT_SCHEMA }),
])).filter(Boolean)

return { contracts, reports, crosscut }
