# Developer guide

This guide is for plugin authors, contributors, and developers embedding Moxxy in TypeScript applications.

## Embed the SDK

```ts
import { Session, runTurn, autoAllowResolver } from '@moxxy/core';
import { anthropicPlugin } from '@moxxy/plugin-provider-anthropic';
import { builtinToolsPlugin } from '@moxxy/tools-builtin';
import { defaultModePlugin } from '@moxxy/mode-default';

const session = new Session({
  cwd: process.cwd(),
  permissionResolver: autoAllowResolver,
});

session.pluginHost.registerStatic(anthropicPlugin);
session.pluginHost.registerStatic(builtinToolsPlugin);
session.pluginHost.registerStatic(defaultModePlugin);
session.providers.setActive('anthropic');

for await (const event of runTurn(session, 'list TypeScript files in cwd')) {
  if (event.type === 'assistant_chunk') process.stdout.write(event.delta);
}
```

## Author a plugin

Use the public SDK helpers to define plugins and their contributions:

```ts
import { definePlugin, defineTool, z } from '@moxxy/sdk';

export default definePlugin({
  name: '@acme/moxxy-plugin-greet',
  tools: [
    defineTool({
      name: 'greet',
      description: 'Return a greeting for the given name.',
      inputSchema: z.object({ name: z.string() }),
      handler: ({ name }) => `Hello, ${name}!`,
    }),
  ],
});
```

Add Moxxy metadata to the plugin's `package.json` so the host can discover it:

```json
{
  "moxxy": {
    "plugin": {
      "entry": "./dist/index.js",
      "kind": "tools"
    }
  }
}
```

Author guides in [`.claude/agents/`](../.claude/agents/) cover skills, plugins, tools, channels, providers, modes, compactors, and cache strategies.

## Architecture

The core dependency direction is intentional:

```text
@moxxy/sdk        typed public surface with zero runtime dependencies
      ↓
@moxxy/core       event log, registries, plugin host, permissions, skills
      ↓
plugins           providers, modes, tools, channels, memory, security, UI
      ↓
@moxxy/runner     session host with Unix socket JSON-RPC
      ↓
clients           CLI, desktop, mobile, HTTP, Telegram, and other channels
```

The hard invariant is that `@moxxy/sdk` has no internal dependencies and `@moxxy/core` does not import plugins. CI enforces this with `pnpm check:deps`.

Major plugin groups include:

- providers for Anthropic, OpenAI, ChatGPT OAuth, Claude Code, and runtime-compatible provider registration
- default, goal, and research modes
- encrypted vault, journal memory, embeddings, speech-to-text, browser, OAuth, MCP, workflows, schedules, and webhooks
- capability security with in-process, worker, subprocess, and experimental WebAssembly isolators
- TUI, Telegram, HTTP, web, and mobile channels
- agent skills, subagents, commands, plugin administration, usage statistics, compaction, and prompt caching

Browse `packages/` for the concrete packages and their local documentation.

## Repository layout

```text
packages/        publishable @moxxy packages
apps/            desktop, mobile, docs, and fixture applications
assets/          project media and demonstrations
docs/            project and operational documentation
tooling/         shared TypeScript, ESLint, and Vitest configuration
.claude/agents/  focused author guides for agent and plugin surfaces
AGENTS.md        repository instructions for coding agents
```

## Local development

Install the pinned workspace package manager and dependencies, then run the standard checks:

```sh
pnpm install
pnpm build
pnpm typecheck
pnpm lint
pnpm test
pnpm check:deps
```

Turbo runs the package-level build, typecheck, and test tasks. CI runs the repository gates on every push and pull request.

See [CONTRIBUTING.md](../CONTRIBUTING.md) for the contribution process and [configuration.md](configuration.md) for runtime settings.
