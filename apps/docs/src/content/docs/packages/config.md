---
title: '@moxxy/config'
description: defineConfig, merge, and load logic for moxxy.config.ts / moxxy.config.yaml.
---

`@moxxy/config` is the schema + loader for moxxy project / user config.
It supports `.ts`, `.js`, `.mjs`, `.json`, and `.yaml`; it merges
user-scope (`~/.moxxy/config.{ts,yaml}`) under project-scope
(`./moxxy.config.{ts,yaml}`).

## Install

```sh
pnpm add @moxxy/config
```

## Define a config

```ts
// moxxy.config.ts
import { defineConfig } from '@moxxy/config';

export default defineConfig({
  provider: {
    name: 'anthropic',
    model: 'claude-sonnet-4-6',
    config: { apiKey: '${vault:ANTHROPIC_API_KEY}' },
  },
  channels: {
    telegram: { token: '${vault:telegram_bot_token}' },
    http: {
      authToken: '${vault:MOXXY_HTTP_TOKEN}',
      allowedTools: ['Read', 'Glob', 'Grep'],
    },
  },
  permissions: {
    allow: [{ name: 'Read' }, { name: 'Glob' }],
  },
  plugins: {
    '@moxxy/synthesize-skill': { enabled: false },
  },
});
```

## Exports

- `defineConfig(config)` — identity-function helper for type inference.
- `loadConfig(opts)` → `{ config, sources }` — discover + parse + merge.
- `mergeConfigs(...)` — deep-merge user under project, project under defaults.
- `buildConfigPlugin({ applier })` — wires loaded config into a plugin (used by the CLI's setup).
- Schemas: `moxxyConfigSchema`, `providerSettingsSchema`,
  `pluginSettingsSchema`, `permissionsConfigSchema`,
  `embeddingsConfigSchema`, `watcherModeSchema`.
- Types: `MoxxyConfig`, `ProviderSettings`, `PluginSettings`,
  `PermissionsConfig`, `EmbeddingsConfig`, `WatcherMode`.

## Vault placeholders

Any string in the loaded config that matches `${vault:NAME}` is resolved
against the active `VaultStore` before plugins see it — see
[@moxxy/plugin-vault](./plugin-vault.md). The CLI's setup runs this pass
before handing the config to plugins.

## File precedence

1. `./moxxy.config.{ts,js,mjs,json,yaml}` (project)
2. `~/.moxxy/config.{ts,yaml}` (user)
3. Built-in defaults

Project keys override user keys; user keys override defaults. Arrays
are replaced, not concatenated — explicit override is safer than
accidental merge.
