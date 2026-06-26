# AGENTS.md — Guide for AI agents working in this repo

You are working in the **moxxy** monorepo: a TypeScript framework for block-based, modular agentic loops. Every block — provider, loop strategy, tool, compactor, channel, skill, even the CLI — is swappable. Skills can synthesize new skills mid-session.

If you're a Claude Code agent or any other autonomous agent: read this file first, then jump to the workflow under `.ai/agents/` that matches your task.

> **Canonical AI catalog: `.ai/`.** Skills and agent author-guides live once under **`.ai/skills/`** and **`.ai/agents/`** — the single source of truth shared across assistants. `.claude/skills`, `.claude/agents`, `.codex/skills`, `.codex/agents` are **symlinks** into `.ai/`. Always edit the files under `.ai/`; never duplicate them under `.claude/` or `.codex/`, and don't chase the symlinked copies in circles. (`.claude/settings.json` and `.claude/hooks/` stay Claude-Code-specific and are NOT mirrored into `.ai/`.)

---

## Architecture, in 90 seconds

```
@moxxy/sdk     <— typed public surface (event types, define* helpers, hook signatures, provider/loop utils)
@moxxy/core    <— runtime (event log, plugin host, registries, permissions, session, skill loader)

@moxxy/tools-builtin              Read/Edit/Write/Bash/Grep/Glob + recall + Sleep
@moxxy/mode-default               "default" mode — Claude Code-style ReAct loop (registered by the CLI; first registered mode auto-activates)
@moxxy/mode-goal                  "goal" mode — autonomous auto-approve loop; works across turns until goal_complete
@moxxy/mode-deep-research         "research" mode — multi-query fan-out + synthesis
@moxxy/compactor-summarize        default summarize-old-turns compactor
@moxxy/cache-strategy-stable-prefix  default prompt-cache strategy (stable-prefix breakpoints; `none` = opt-out)
@moxxy/skills-builtin             MD skills shipped with the framework

@moxxy/plugin-provider-anthropic  first-party provider
@moxxy/plugin-provider-openai     OpenAI provider
@moxxy/plugin-vault               encrypted secret store (AES-256-GCM + keytar fallback)
@moxxy/plugin-memory              long-term memory journal + TF-IDF / vector recall
@moxxy/plugin-cli                 Ink TUI components + interactive PermissionResolver
@moxxy/plugin-telegram            Telegram channel (TOFU pairing)
@moxxy/plugin-channel-http        HTTP channel (auth + allow-list resolver)
@moxxy/plugin-channel-web         web surface channel — serves a browser app rendering agent-authored view-spec UIs over a WebSocket
@moxxy/plugin-channel-mobile      mobile channel — serves the desktop IPC contract over an authenticated WebSocket (`moxxy mobile`)
@moxxy/plugin-view                present_view tool — agent-authored JSX-like view-spec parsed into a validated AST channels can render
@moxxy/plugin-mcp                 MCP server bridge
@moxxy/plugin-embeddings-openai   OpenAI embeddings
@moxxy/plugin-embeddings-transformers   on-device embeddings via xenova
@moxxy/plugin-browser             web_fetch tool + Playwright sidecar (heavy)
@moxxy/plugin-scheduler           cron/heartbeat: time-driven prompts + auto-scheduled skills
@moxxy/plugin-workflows           swappable DAG engine: chain skills/prompts/tools into saved, schedulable pipelines
@moxxy/plugin-security            opt-in capability isolation: Isolator interface + `none` / `inproc` impls
@moxxy/isolator-worker            worker_threads-based Isolator (memory + time + JS-state isolation)
@moxxy/isolator-subprocess        subprocess Isolator (kernel-enforced process boundary)
@moxxy/isolator-wasm              WebAssembly Isolator (zero ambient authority; experimental)
@moxxy/plugin-provider-openai-codex  ChatGPT OAuth provider (Responses API)
@moxxy/plugin-provider-claude-code  Claude Pro/Max OAuth provider (Messages API, bearer token)
@moxxy/plugin-provider-admin      register OpenAI-compatible providers at runtime
@moxxy/plugin-oauth               generic OAuth 2.0 + PKCE / device-code
@moxxy/plugin-stt-whisper         Whisper transcriber (voice in); `-codex` variant reuses ChatGPT creds
@moxxy/plugin-computer-control    macOS native input (screenshot/click/type)
@moxxy/plugin-subagents           dispatch typed sub-agents from a turn
@moxxy/plugin-commands            built-in slash commands (/info, /clear, /compact, …)
@moxxy/plugin-self-update         agent edits its own plugins/skills (Tier 1) + core (Tier 2)
@moxxy/plugin-plugins-admin       install / remove / enable / disable plugins at runtime (model tools + `moxxy plugins` CLI + `/plugins` picker)
@moxxy/plugin-usage-stats         per-session token + cost accounting
@moxxy/plugin-webhooks            external-event triggers (verified HTTP listener + tunnels)
@moxxy/runner                     bare session runner; channels attach over a unix socket (JSON-RPC)

@moxxy/config      defineConfig + loader (cosmiconfig-style discovery + zod validation)
@moxxy/testing     FakeProvider + record/replay harness
@moxxy/chat-model  UI-neutral chat model: event→block fold (tool/skill/subagent grouping) + format helpers + markdown AST + a chunked append log; shared by the Ink TUI and the desktop
@moxxy/cli         the `moxxy` binary

apps/desktop                 Electron desktop app — attaches to @moxxy/runner, renders a TUI-equivalent chat surface. Self-updates its JS layers (renderer+main+preload+IPC) via a signed app bundle behind an immutable bootstrap loader (electron/main/bootstrap.ts) — no reinstall; native-shell bumps go through electron-updater (Tier 2). See docs/desktop-self-update.md.
@moxxy/desktop-ipc-contract  typed IPC boundary (channel names + payloads + Zod validation) shared by the desktop's main / preload / renderer
@moxxy/desktop-host          the desktop's Electron main process: runner pool + supervisor, session driver, IPC handlers, append-only NDJSON chat log, security gates, and the self-update gate/stager (the node-only @moxxy/desktop-host/app-update subpath baked into the bootstrap)
@moxxy/desktop-ui            framework-light, dependency-free React UI primitives (single-file SVG Icon set, Modal/ConfirmModal portal, Skeleton placeholders); shared by the renderer and a future web channel
@moxxy/client-core           DOM-free headless client layer (chat/connection/ask stores + use* React hooks + transport seam + platform-capability registry); shared by the desktop renderer and the Expo mobile app
@moxxy/client-platform-web   web implementations of the client-core platform capabilities (mic capture, Web Speech TTS, localStorage KV, window event bus)
@moxxy/client-transport-ws   MoxxyApi (invoke/subscribe) over a WebSocket JSON-RPC client for remote clients (uses the global WebSocket — Metro/RN-safe)
@moxxy/ipc-server-ws         serves the desktop IPC contract over an authenticated WebSocket (WebSocketCommandBus; bearer-token handshake; Node-only)
@moxxy/design-tokens         framework-neutral design tokens (colors/fonts/radii/shadows) + :root CSS-variable generator; consumed by the desktop renderer and React Native
```

**State model.** Every interaction appends to an immutable event log; derived state is a pure fold. Any session can be replayed from its log.

**Plugin model.** Plugins are TS code distributed as `@moxxy/*` npm packages, auto-discovered via `package.json#moxxy.plugin.entry`. The CLI also auto-loads any package under `~/.moxxy/plugins/*/` that carries that manifest. Plugins contribute `tools`, `providers`, `loopStrategies`, `compactors`, `cacheStrategies`, `channels`, and `hooks` via `definePlugin({...})`.

**Caching model.** A `CacheStrategy` decides *where* prompt-cache breakpoints go and returns provider-neutral `CacheHint`s (`{ target: 'tools' | 'system' | { messageIndex } }`); the provider expresses them (Anthropic → `cache_control`). One is active per session — registered via plugins exactly like compactors/modes; first registered auto-activates. `@moxxy/cache-strategy-stable-prefix` is the default (static prefix + rolling tail); `none` opts out. `plan()` MUST be deterministic given identical inputs — a non-deterministic breakpoint shifts the cached prefix between calls and silently defeats the cache (paying 1.25x writes for 0 reads).

**Channels.** A `Channel` is a bidirectional surface that drives a Session — TUI, Telegram, HTTP, etc. Channels expose `subcommands` for one-shot maintenance ops (`moxxy channels telegram pair|unpair|status`); the CLI's `bin.ts` knows nothing about specific channels.

**Skill model.** Skills are Markdown files with YAML frontmatter (Claude Code-compatible). They are *prompt-only* — never executable code. Resolution order:

1. `./.moxxy/skills/**/*.md` (project, checked into git)
2. `~/.moxxy/skills/**/*.md` (user; **default target for auto-synthesized skills**)
3. `<plugin>/skills/**/*.md` (bundled with a plugin via `skillsDir`)
4. `@moxxy/skills-builtin`

When a user prompt matches no existing skill, the loop invokes `synthesize_skill` (built-in tool), persists to user scope, hot-swaps the registry via `SkillRegistryImpl.replaceAll`, and routes the next request through the new skill.

**Secrets.** API keys are resolved in this order: explicit `provider.config.apiKey` in `moxxy.config.ts` → `@moxxy/plugin-vault` (encrypted file under `~/.moxxy/vault.json`, unlocked via keytar or `MOXXY_VAULT_PASSPHRASE`) → `<PROVIDER>_API_KEY` env var → interactive prompt (TTY only; prompted values are persisted to the vault).

**Permission flow.** Every tool call passes through (1) `dispatchToolCall` hooks (plugins can `deny` or `rewrite`), (2) `PermissionEngine` policy file at `~/.moxxy/permissions.json` (with `inputMatches` regex support), (3) the active `PermissionResolver` (deny-by-default headless, interactive TUI/Telegram/HTTP allow-list, or `createDeferredPermissionResolver` from core for new channels). Decisions of `allow_session` are remembered per resolver instance.

---

## The hard invariants (dep-cruiser enforced)

1. **`@moxxy/sdk` has zero internal deps.** It's the typed public surface.
2. **`@moxxy/core` never imports a plugin.** Static imports from core into `@moxxy/plugin-*`, `@moxxy/mode-*`, `@moxxy/compactor-*`, `@moxxy/cache-strategy-*`, or `@moxxy/skills-builtin` are forbidden. Plugins are dynamically loaded — pulling them in statically inverts the dependency arrow.
3. **Plugins CAN import from `@moxxy/core`** (and several do — channels need `Session`, `runTurn`, `createDeferredPermissionResolver`). The hard rule is the reverse direction.
4. **No circular deps.** Re-route through `@moxxy/sdk`.

Run `pnpm check:deps` to verify after structural changes.

---

## Workflows you can execute

| Task | Open this file |
|---|---|
| Create a new Markdown skill | `.ai/agents/skill-author.md` |
| Create a new `@moxxy/plugin-*` package | `.ai/agents/plugin-author.md` |
| Add one tool to a plugin | `.ai/agents/tool-author.md` |
| Implement an `LLMProvider` for a new model API | `.ai/agents/provider-author.md` |
| Build a text-to-speech `Synthesizer` plugin (ElevenLabs / OpenAI TTS / local) | `.ai/agents/synthesizer-author.md` |
| Build a new loop strategy | `.ai/agents/loop-strategy-author.md` |
| Build a new `Compactor` | `.ai/agents/compactor-author.md` |
| Build a new `CacheStrategy` (prompt-cache breakpoints) | `.ai/agents/cache-strategy-author.md` |
| Build a new `Channel` | `.ai/agents/channel-author.md` |
| Add a security isolator (worker / subprocess / wasm / docker / …) | `.ai/agents/isolator-author.md` |
| Modify `@moxxy/core` itself | `.ai/agents/core-extender.md` |
| Reproduce and isolate a bug | `.ai/agents/bug-hunter.md` |
| Identify gaps and propose improvements | `.ai/agents/self-improver.md` |

**Skill library.** Beyond these deep workflows, `.ai/skills/` holds ~28 thin,
task-scoped SKILL.md checklists (dev loop, every extension point, verify/debug
recipes, process rules) — scan the index at `.ai/skills/README.md` and read
only the one that matches your task. Claude Code hooks in `.claude/settings.json`
(see `.claude/hooks/README.md`) backstop the typecheck gate and the changeset
requirement automatically.

---

## Tech guardrails — do this, not that

### Do

- **Rebuild the whole repo after every code change, before reporting work done.** Run `pnpm build` (root → `turbo run build`) — it's turbo-cached so unchanged packages are instant; only what you touched recompiles. The CLI binary is bundled by tsup and won't reflect source edits until rebuilt, so "tests pass" is not "the app works." Don't claim a change is done or hand off without a green full build.
- **Use the SDK's shared helpers.** `collectProviderStream`, `projectMessagesFromLog`, `isRetryableError`, `zodToJsonSchema`, `CachedEmbeddingProvider` — all exported from `@moxxy/sdk`. New loops/providers/embedders should compose these instead of reimplementing.
- **Filter event-log subscribers by `turnId`** when serving multiple turns on one Session (e.g., HTTP channel). The shared `session.log` fans out to every listener; without the filter, concurrent turns cross-contaminate (see `run-turn.ts`).
- **Persist atomically.** Vault, permissions, memory, skills — anything writing a whole file does `writeFile(tmp); rename(tmp, final)`. POSIX rename is atomic; crash mid-write leaves the previous file intact.
- **Serialize file-state mutators per instance.** Stores that read-modify-write the whole file (vault, permissions) need a promise-chain mutex; otherwise two concurrent mutations clobber each other.
- **Track high-water marks in compactors.** Re-scanning from index 0 every call layers nested summaries; check prior `CompactionEvent.replacedRange[1]` and resume after.
- **Wire every lifecycle hook.** `onEvent` needs `EventLog.subscribe → dispatcher.dispatchEvent`. `onShutdown` needs `Session.close()`. Declaring a hook without dispatching it is a silent dead-letter (we shipped that bug once — don't repeat).
- **Use `Session.setPermissionResolver(r)`** to swap resolvers. Never `(session as unknown as {resolver}).resolver = ...`.
- **Use `defineX(spec): XDef` factories.** They `Object.freeze` the spec and (for `definePlugin`) stamp `__moxxy: 'plugin'` and a default `version`.
- **Add a changeset to EVERY PR — CI enforces it.** Run `pnpm changeset` (or hand-write `.changeset/<name>.md`) and pick the bump for `@moxxy/cli` / `@moxxy/sdk` / `@moxxy/desktop`. No changeset → no version bump → nothing ships. The `Changeset present` CI job fails any PR without one. For a change that releases nothing (docs / CI / tests), say so on purpose with `pnpm changeset --empty`. See [Releasing](#releasing-changesets).

### Tech debt is a standing job — own it like a CTO

`TECH_DEBT.md` is a **living journal**, not an archive. You are expected to actively keep
it valid and to chip away at it as you work — treat reducing debt as part of every task,
not a separate chore someone else does.

- **Read it before non-trivial work.** Whenever you start something more than a one-line
  edit, skim `TECH_DEBT.md` first. If your task touches an area with an open item, prefer
  to resolve that item as part of the work.
- **Every change retires at least one item.** Each time you ship a change, pick one entry
  off the ledger and close it (or knock out a quick win nearby). Remove resolved entries —
  don't let them rot — and move the one-liner into the "Resolved ledger" so the journal
  keeps a record.
- **Write new debt down the moment you see it.** If you introduce a shortcut, notice a
  duplication, or spot a gap, add it to the appropriate P1/P2/P3 section with concrete
  `file:line` evidence and a severity. Debt you can't fix now still gets recorded now.
- **Bigger implementations trigger a re-audit.** For any sizeable feature or refactor,
  re-audit the subsystem you touched and refresh the relevant `TECH_DEBT.md` items — verify
  the open ones are still accurate, mark what your work resolved, and add what it exposed.
  The goal is that the file is always trustworthy and up to date.
- **Make the CTO call on pacing.** Always carve out time for a quick win or two; periodically
  *propose* a bigger debt-reduction effort to the user when the payoff justifies it (e.g. the
  desktop dual-persistence unification or the runner/thin-client retype). Balance shipping
  features against keeping the codebase healthy — and say so explicitly when you defer.

### Don't

- **Don't add a dependency without justification.** The framework is intended to be light. Built-ins use only Node stdlib + `zod` + `ulid` + `jiti`. Plugin authors can add their own — but core/SDK stays minimal.
- **Don't import from `@moxxy/core` inside `@moxxy/sdk` or any plugin that contributes to the loop runtime** (loops, compactors, providers without UI). Channels are the exception.
- **Don't mutate the event log.** Append-only. Compaction adds a `compaction` event with `replacedRange`; selectors honor it. Selectors must stay pure folds.
- **Don't introduce features that need importing a plugin from core.** Use lifecycle hooks, or pass services via closure (see `buildSynthesizeSkillPlugin(session)` for the pattern).
- **Don't bypass the permission engine.** Tool handlers trust that their input has already been gated by `dispatchToolCall` + `PermissionEngine` + the active `PermissionResolver`. Don't add ad-hoc "is this safe" checks inside handlers.
- **Don't write multi-paragraph docstrings or planning files.** Comments only when the WHY is non-obvious; prefer well-named identifiers + tests.
- **Don't `--no-verify` git commits or bypass dep-cruiser.** Fix the underlying issue.

---

## Branching model

Two long-lived branches:

- **`development`** — the integration branch and the repo **default**. Every feature/fix PR targets it and must be green here (build + typecheck + lint + test + `Changeset present` + deps). This is where continuous development happens **and where versioning + releasing run from**.
- **`main`** — the **production** branch, **publish-only and machine-advanced**. You never push it, never open a PR into it, and never feature-branch off it. The **Release** workflow advances it to exactly `development`'s content as one clean `Release: v…` commit per release; `git log --first-parent main` is the release history.

So: **branch off `development`, PR back into `development`. Never target `main`.**

**Cutting a release** — one workflow, `.github/workflows/release.yml`, runs on `development` (daily `cron` 06:00 UTC + on-demand `workflow_dispatch`). In a **single run** it:
1. **Versions** — if changesets are pending on `development`, consolidates them into **one** `changeset version` bump committed to `development` (land as many changeset-carrying PRs during the day as you like; they batch into the daily bump).
2. **Publishes** the bumped packages to npm via `scripts/safe-publish.mjs` (idempotent — skips versions already on the registry).
3. **Advances `main`** — copies development's tree onto `main` as one `Release: v…` commit via `git commit-tree` (tree = development, parent = current `origin/main`), then fast-forwards `main`.
4. **Cuts the desktop** release when `@moxxy/desktop`'s version changed.

> **Why this can never conflict (the old failure, fixed):** advancing `main` is a tree **copy**, not a merge — `commit-tree` makes a commit whose tree is development's and whose parent is `origin/main`, so there is no merge-base, no 3-way, no hunks to reconcile. Conflict-freedom is a property of git's object model, not of any workflow firing. The previous design squash-merged a `development → main` PR and leaned on a `sync-back.yml` (`on: push: main`) to repair the ancestry a squash breaks — but GitHub never fires workflows for `GITHUB_TOKEN` pushes, so the sync-back never ran, `main` drifted out of ancestry, and every `dev → main` PR re-conflicted. There is **no `development → main` PR, no squash-merge, and no sync-back** anymore.

## Releasing (changesets)

Versioning and publishing are driven by **changesets** — there is no manual `npm version` / `npm publish`. **Every feature PR (→ `development`) must include a changeset — CI (the `Changeset present` job) fails it without one.** A change that releases nothing (docs / CI / tests) still needs one: add an empty changeset with `pnpm changeset --empty`. (There is no separate release PR — the daily Release workflow versions and ships whatever changesets merged to `development` that day.)

- **Published packages:** only `@moxxy/cli` and `@moxxy/sdk` (everything else is `private` and bundled into the CLI binary by tsup). The private **`@moxxy/desktop`** also rides changesets — naming it cuts a desktop installer release (it is never published to npm), and because the desktop depends on `@moxxy/cli` / `@moxxy/sdk`, a CLI/SDK bump cascades a patch bump to it automatically.
- **Add one:** `pnpm changeset` → pick the package(s) + bump (patch / minor / major) + write a one-line summary. This drops a file in `.changeset/`. Commit it with your PR.
- **What happens, in order** (all in `.github/workflows/release.yml`, on `development`, daily/on-demand):
  1. **Version:** `changeset version` bumps `package.json` versions, writes changelogs, deletes the consumed changesets — committed to `development`.
  2. **Publish:** `scripts/safe-publish.mjs` publishes the bumped packages to npm (idempotent — re-runs skip versions already on the registry).
  3. **Advance `main`:** development's tree is copied onto `main` as one `Release: v…` commit (`git commit-tree`, parent = `origin/main`) and fast-forwarded — a tree copy that cannot conflict, no PR, no merge.
  4. **Desktop:** if `@moxxy/desktop`'s version changed, the installers build and a **draft** `desktop-v<version>` release is cut (tag pushed only after every build leg succeeds).
- **Publish uses `pnpm publish`, not `npm publish`** — pnpm rewrites the `workspace:*` and `catalog:` protocols to real version ranges. `npm publish` ships them verbatim and the tarball becomes uninstallable (`EUNSUPPORTEDPROTOCOL "workspace:"`). Don't change `safe-publish.mjs` back to `npm publish`.

## Quick commands

```sh
pnpm install              # install workspace deps
pnpm -r build             # build every package
pnpm -r typecheck         # typecheck every package
pnpm -r test              # run every test suite
pnpm --filter <pkg> test  # run a single package's tests
pnpm check:deps           # enforce architectural invariants

# Try the CLI:
node packages/cli/dist/bin.js --help
ANTHROPIC_API_KEY=sk-... node packages/cli/dist/bin.js -p "list files" --allow-tools Read,Glob
moxxy doctor --check-keys  # diagnose config / vault / providers / channels
moxxy channels             # list registered channels + subcommands
moxxy plugins new myplug   # scaffold a user-scope plugin
```
