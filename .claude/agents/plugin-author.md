---
name: plugin-author
description: Scaffold a new @moxxy/plugin-* package and wire it for hot-load.
---

# Plugin author — ship a new `@moxxy/plugin-*`

Plugins are TypeScript packages distributed under the `@moxxy/*` scope. They contribute tools, providers, loop strategies, compactors, and lifecycle hooks via `definePlugin` from `@moxxy/sdk`.

## Skeleton

Create `packages/plugin-<thing>/`:

```jsonc
// packages/plugin-<thing>/package.json
{
  "name": "@moxxy/plugin-<thing>",
  "version": "0.0.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "moxxy": {
    "plugin": {
      "entry": "./src/index.ts",   // .ts in dev (jiti), .js in prod
      "kind": "tools"              // tools|provider|loop|compactor|mcp|cli|hooks
    }
  },
  "dependencies": { "@moxxy/sdk": "workspace:*" },
  "devDependencies": {
    "@moxxy/tsconfig": "workspace:*",
    "@moxxy/vitest-preset": "workspace:*",
    "typescript": "^5.7.3",
    "vitest": "^2.1.8"
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  }
}
```

```jsonc
// packages/plugin-<thing>/tsconfig.json
{ "extends": "@moxxy/tsconfig/lib.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src/**/*"], "exclude": ["dist", "node_modules", "src/**/*.test.ts"] }
```

```ts
// packages/plugin-<thing>/src/index.ts
import { definePlugin, defineTool, z } from '@moxxy/sdk';

const myTool = defineTool({
  name: 'my_tool',
  description: 'one sentence',
  inputSchema: z.object({ input: z.string() }),
  permission: { action: 'prompt' },
  handler: async ({ input }, ctx) => `echo: ${input}`,
});

export default definePlugin({
  name: '@moxxy/plugin-<thing>',
  version: '0.0.0',
  tools: [myTool],
});
```

## Wire it up

1. Run `pnpm install` from repo root. The workspace auto-links the new package.
2. The plugin host auto-discovers it via `package.json#moxxy.plugin`. No registration code needed.
3. For hot-load in a running session, call `session.pluginHost.reload()` (or run the `reload_plugins` tool). The `tsx`/`jiti` loader handles `.ts` entries directly; production builds compile to `dist/`.

## Lifecycle hooks

```ts
import { definePlugin } from '@moxxy/sdk';

export default definePlugin({
  name: '@moxxy/plugin-<thing>',
  hooks: {
    onInit: async (ctx) => { /* setup */ },
    onToolCall: async (ctx) => ({ action: 'allow' }),  // or 'deny' / 'rewrite'
    onBeforeProviderCall: (req) => ({ ...req, system: (req.system ?? '') + ' extra' }),
    onEvent: async (e) => { /* observe — read only */ },
    onShutdown: async () => { /* cleanup */ },
  },
});
```

`onToolCall` short-circuits on first `deny`. `onBeforeProviderCall` is a fold — each plugin's returned request feeds the next. `onEvent` is fan-out and read-only. Hook timeout defaults to 5s.

## Tests

Mirror the `@moxxy/loop-tool-use` test pattern: build a small in-memory `Session` via `@moxxy/testing`'s helpers, register your plugin via `session.pluginHost.registerStatic(myPlugin)`, then drive a turn with `collectTurn(session, prompt)` and assert on emitted events.

## Don't

- **Don't import from `@moxxy/core`.** Plugins consume only `@moxxy/sdk`. Core may re-export some helpers, but importing core couples your plugin to runtime internals.
- **Don't bypass the permission engine.** Use `permission: { action: 'prompt' }` on any tool with side effects.
- **Don't mutate inputs in-place inside `onBeforeProviderCall`.** Return a new request object.
