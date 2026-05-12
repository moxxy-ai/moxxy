# AGENTS.md — Guide for AI agents working in this repo

You are working in the **moxxy** monorepo: a TypeScript framework for block-based, modular agentic loops. Every block — provider, loop strategy, tool, compactor, channel, skill, even the CLI — is swappable. Skills can synthesize new skills mid-session.

If you're a Claude Code agent or any other autonomous agent: read this file first, then jump to the workflow under `.claude/agents/` that matches your task.

---

## Architecture, in 90 seconds

```
@moxxy/sdk     <— typed public surface (event types, define* helpers, hook signatures, provider/loop utils)
@moxxy/core    <— runtime (event log, plugin host, registries, permissions, session, skill loader)

@moxxy/tools-builtin              Read/Edit/Write/Bash/Grep/Glob
@moxxy/loop-tool-use              default loop strategy (Claude Code-style)
@moxxy/loop-plan-execute          alt loop strategy
@moxxy/compactor-summarize        default summarize-old-turns compactor
@moxxy/skills-builtin             MD skills shipped with the framework

@moxxy/plugin-provider-anthropic  first-party provider
@moxxy/plugin-provider-openai     OpenAI provider
@moxxy/plugin-vault               encrypted secret store (AES-256-GCM + keytar fallback)
@moxxy/plugin-memory              long-term memory journal + TF-IDF / vector recall
@moxxy/plugin-cli                 Ink TUI components + interactive PermissionResolver
@moxxy/plugin-telegram            Telegram channel (TOFU pairing)
@moxxy/plugin-channel-http        HTTP channel (auth + allow-list resolver)
@moxxy/plugin-mcp                 MCP server bridge
@moxxy/plugin-embeddings-openai   OpenAI embeddings
@moxxy/plugin-embeddings-transformers   on-device embeddings via xenova
@moxxy/plugin-browser             web_fetch tool + Playwright sidecar (heavy)
@moxxy/plugin-scheduler           cron/heartbeat: time-driven prompts + auto-scheduled skills

@moxxy/config      defineConfig + loader (cosmiconfig-style discovery + zod validation)
@moxxy/testing     FakeProvider + record/replay harness
@moxxy/cli         the `moxxy` binary
```

**State model.** Every interaction appends to an immutable event log; derived state is a pure fold. Any session can be replayed from its log.

**Plugin model.** Plugins are TS code distributed as `@moxxy/*` npm packages, auto-discovered via `package.json#moxxy.plugin.entry`. The CLI also auto-loads any package under `~/.moxxy/plugins/*/` that carries that manifest. Plugins contribute `tools`, `providers`, `loopStrategies`, `compactors`, `channels`, and `hooks` via `definePlugin({...})`.

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
2. **`@moxxy/core` never imports a plugin.** Static imports from core into `@moxxy/plugin-*`, `@moxxy/loop-plan-execute`, `@moxxy/compactor-*`, or `@moxxy/skills-builtin` are forbidden. Plugins are dynamically loaded — pulling them in statically inverts the dependency arrow.
3. **Plugins CAN import from `@moxxy/core`** (and several do — channels need `Session`, `runTurn`, `createDeferredPermissionResolver`). The hard rule is the reverse direction.
4. **No circular deps.** Re-route through `@moxxy/sdk`.

Run `pnpm check:deps` to verify after structural changes.

---

## Workflows you can execute

| Task | Open this file |
|---|---|
| Create a new Markdown skill | `.claude/agents/skill-author.md` |
| Create a new `@moxxy/plugin-*` package | `.claude/agents/plugin-author.md` |
| Add one tool to a plugin | `.claude/agents/tool-author.md` |
| Implement an `LLMProvider` for a new model API | `.claude/agents/provider-author.md` |
| Build a new loop strategy | `.claude/agents/loop-strategy-author.md` |
| Build a new `Compactor` | `.claude/agents/compactor-author.md` |
| Build a new `Channel` | `.claude/agents/channel-author.md` |
| Modify `@moxxy/core` itself | `.claude/agents/core-extender.md` |
| Reproduce and isolate a bug | `.claude/agents/bug-hunter.md` |
| Identify gaps and propose improvements | `.claude/agents/self-improver.md` |

---

## Tech guardrails — do this, not that

### Do

- **Use the SDK's shared helpers.** `collectProviderStream`, `projectMessagesFromLog`, `isRetryableError`, `zodToJsonSchema`, `CachedEmbeddingProvider` — all exported from `@moxxy/sdk`. New loops/providers/embedders should compose these instead of reimplementing.
- **Filter event-log subscribers by `turnId`** when serving multiple turns on one Session (e.g., HTTP channel). The shared `session.log` fans out to every listener; without the filter, concurrent turns cross-contaminate (see `run-turn.ts`).
- **Persist atomically.** Vault, permissions, memory, skills — anything writing a whole file does `writeFile(tmp); rename(tmp, final)`. POSIX rename is atomic; crash mid-write leaves the previous file intact.
- **Serialize file-state mutators per instance.** Stores that read-modify-write the whole file (vault, permissions) need a promise-chain mutex; otherwise two concurrent mutations clobber each other.
- **Track high-water marks in compactors.** Re-scanning from index 0 every call layers nested summaries; check prior `CompactionEvent.replacedRange[1]` and resume after.
- **Wire every lifecycle hook.** `onEvent` needs `EventLog.subscribe → dispatcher.dispatchEvent`. `onShutdown` needs `Session.close()`. Declaring a hook without dispatching it is a silent dead-letter (we shipped that bug once — don't repeat).
- **Use `Session.setPermissionResolver(r)`** to swap resolvers. Never `(session as unknown as {resolver}).resolver = ...`.
- **Use `defineX(spec): XDef` factories.** They `Object.freeze` the spec and (for `definePlugin`) stamp `__moxxy: 'plugin'` and a default `version`.

### Don't

- **Don't add a dependency without justification.** The framework is intended to be light. Built-ins use only Node stdlib + `zod` + `ulid` + `jiti`. Plugin authors can add their own — but core/SDK stays minimal.
- **Don't import from `@moxxy/core` inside `@moxxy/sdk` or any plugin that contributes to the loop runtime** (loops, compactors, providers without UI). Channels are the exception.
- **Don't mutate the event log.** Append-only. Compaction adds a `compaction` event with `replacedRange`; selectors honor it. Selectors must stay pure folds.
- **Don't introduce features that need importing a plugin from core.** Use lifecycle hooks, or pass services via closure (see `buildSynthesizeSkillPlugin(session)` for the pattern).
- **Don't bypass the permission engine.** Tool handlers trust that their input has already been gated by `dispatchToolCall` + `PermissionEngine` + the active `PermissionResolver`. Don't add ad-hoc "is this safe" checks inside handlers.
- **Don't write multi-paragraph docstrings or planning files.** Comments only when the WHY is non-obvious; prefer well-named identifiers + tests.
- **Don't `--no-verify` git commits or bypass dep-cruiser.** Fix the underlying issue.

---

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
