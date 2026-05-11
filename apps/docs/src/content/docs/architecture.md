---
title: Architecture
description: The shape of moxxy — sdk, core, plugins, channels.
---

## The blocks

```
@moxxy/sdk             <— typed public surface (zero runtime deps)
@moxxy/core            <— runtime: event log, registries, plugin host, permissions
@moxxy/tools-builtin   <— Read/Edit/Write/Bash/Grep/Glob
@moxxy/loop-tool-use   <— default Claude Code-style loop strategy
@moxxy/loop-plan-execute  <— alternate plan-then-execute strategy
@moxxy/plugin-provider-anthropic  <— LLM provider
@moxxy/plugin-mcp                 <— MCP servers as tool sources
@moxxy/plugin-vault    <— AES-256-GCM encrypted secrets
@moxxy/plugin-memory   <— journal LTM + STM helpers + vector recall
@moxxy/plugin-cli      <— Ink TUI components + TuiChannel
@moxxy/plugin-telegram <— TelegramChannel via grammy
@moxxy/cli             <— the `moxxy` binary
```

## State model

Every interaction appends to an immutable event log. Derived state (projected message history, pending tool calls, loaded plugins, …) is a pure fold over the log via selectors.

This shape gives you replay-debugging for free: dump a session log to JSON, feed it back through `replay()`, and you get the exact same derived state.

## Plugin model

Plugins are TypeScript code, distributed as `@moxxy/*` (or `@anyone/*`) npm packages, auto-discovered via `package.json#moxxy.plugin`. They contribute:

- **Tools** (`defineTool`) — actions the model can invoke
- **Providers** (`defineProvider`) — LLM backends
- **Loop strategies** (`defineLoopStrategy`) — how a turn unfolds
- **Compactors** (`defineCompactor`) — context-window management
- **Lifecycle hooks** — `onInit`, `onToolCall`, `onBeforeProviderCall`, …
- **Bundled skills** — Markdown files shipped with the plugin

## Channel model

A `Channel` is a bidirectional frontend that owns a Session: feeds user prompts in, renders assistant chunks + tool activity out, implements `PermissionResolver`. The TUI and Telegram are both Channels. Future Slack/Discord/HTTP channels slot in identically.

```ts
interface Channel<TStartOpts = unknown> {
  readonly name: string;
  readonly permissionResolver: PermissionResolver;
  start(opts: TStartOpts): Promise<ChannelHandle>;
}
```

## Skill model

Skills are prompt-only — Markdown files with YAML frontmatter, Claude Code-compatible. They live, in precedence order:

1. `./.moxxy/skills/**/*.md` (project, checked in)
2. `~/.moxxy/skills/**/*.md` (user; **default target for auto-synthesized skills**)
3. `<plugin>/skills/**/*.md` (bundled with a plugin)
4. `@moxxy/skills-builtin`

When a user prompt matches no existing skill, the loop invokes the built-in `synthesize_skill` tool: the agent drafts a new skill, the user approves, it's written to user-scope, the registry hot-reloads, and the next prompt routes through it.

## The hard invariant

- `@moxxy/sdk` has **zero internal dependencies**.
- `@moxxy/core` imports only from `@moxxy/sdk` and `@moxxy/tools-builtin`.
- `@moxxy/core` does **not** import any plugin.

These are enforced in CI via `pnpm check:deps` (dependency-cruiser). Plugins are allowed to import core (channel plugins like `plugin-telegram` use `runTurn`), but the reverse never holds.
