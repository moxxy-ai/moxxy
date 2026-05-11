# AGENTS.md — Guide for AI agents working in this repo

You are working in the **moxxy** monorepo: a TypeScript framework for block-based, modular agentic loops. Every block — provider, loop strategy, tool, compactor, skill, even the CLI — is swappable. Skills can synthesize new skills mid-session.

If you're a Claude Code agent or any other autonomous agent: read this file first, then jump to the workflow under `.claude/agents/` that matches your task.

---

## Architecture, in 90 seconds

```
@moxxy/sdk     <— typed public surface (event types, define* helpers, hook signatures)
@moxxy/core    <— runtime (event log, plugin host, registries, permissions, skill loader)
@moxxy/tools-builtin       Read/Edit/Write/Bash/Grep/Glob
@moxxy/loop-tool-use       default loop strategy (Claude Code-style)
@moxxy/compactor-summarize default summarize-old-turns compactor
@moxxy/plugin-provider-anthropic   first-party provider
@moxxy/skills-builtin      MD skills shipped with the framework
@moxxy/testing             FakeProvider + record/replay harness
@moxxy/cli                 the `moxxy` binary
```

**State model.** Every interaction appends to an immutable event log; derived state is a pure fold. Any session can be replayed from its log.

**Plugin model.** Plugins are TS code distributed as `@moxxy/*` npm packages, auto-discovered via `package.json#moxxy.plugin`. They contribute tools, providers, loop strategies, compactors, and lifecycle hooks. The SDK exposes `definePlugin`, `defineTool`, `defineProvider`, `defineLoopStrategy`, `defineCompactor`.

**Skill model.** Skills are Markdown files with YAML frontmatter (Claude Code-compatible). They are *prompt-only* — never executable code. They live, in precedence order:

1. `./.moxxy/skills/**/*.md` (project, checked into git)
2. `~/.moxxy/skills/**/*.md` (user; **default target for auto-synthesized skills**)
3. `<plugin>/skills/**/*.md` (bundled with a plugin)
4. `@moxxy/skills-builtin`

When a user prompt matches no existing skill, the loop synthesizes one via `synthesize_skill` (built-in tool), persists to user scope, hot-reloads the registry, and routes the next request through the new skill.

**The hard invariant.** `@moxxy/sdk` has zero internal deps. `@moxxy/core` depends only on `@moxxy/sdk` (and `@moxxy/tools-builtin`). **No plugin is ever imported by core.** Plugins import only from `@moxxy/sdk`. If you find yourself wanting to import a plugin from core, your design is wrong — re-route via the plugin lifecycle or registries.

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
| Modify `@moxxy/core` itself | `.claude/agents/core-extender.md` |
| Reproduce and isolate a bug | `.claude/agents/bug-hunter.md` |
| Identify gaps and propose improvements | `.claude/agents/self-improver.md` |

---

## House rules

- **Test everything.** Vitest is configured in every package via `@moxxy/vitest-preset`. Prefer recorded fixtures (`MOXXY_FIXTURES=record` then `=replay`) over mocks — the harness lives in `@moxxy/testing`.
- **No new dependencies without justification.** The whole framework is intended to be light. Built-in tools, skill parsing, and plugin discovery use only Node stdlib + `zod` + `ulid` + `jiti`.
- **`zod` is the canonical schema lib.** Re-exported from `@moxxy/sdk` so plugin authors don't need to install it separately.
- **Don't break the event log invariant.** Events are append-only. Compaction adds a new event; it never mutates or removes prior events.
- **Don't add features that require importing a plugin from core.** Use lifecycle hooks or pass services via closure (see `buildSynthesizeSkillPlugin` for the pattern).
- **Workflow for risky changes.** Read the relevant `.claude/agents/*.md` before editing. Run `pnpm -r test && pnpm -r build` after every non-trivial change.

---

## Quick commands

```sh
pnpm install              # install workspace deps
pnpm -r build             # build every package
pnpm -r typecheck         # typecheck every package
pnpm -r test              # run every test suite
pnpm --filter <pkg> test  # run a single package's tests

# Try the CLI:
node packages/cli/dist/bin.js --help
ANTHROPIC_API_KEY=sk-... node packages/cli/dist/bin.js -p "list files" --allow-tools Read,Glob
```
