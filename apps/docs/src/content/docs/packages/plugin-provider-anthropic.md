---
title: '@moxxy/plugin-provider-anthropic'
description: Anthropic LLM provider for moxxy.
---

`@moxxy/plugin-provider-anthropic` is the Anthropic provider plugin.
API-key auth; ships the full Claude model list.

## Install

```sh
pnpm add @moxxy/plugin-provider-anthropic
```

## Use

```ts
import { anthropicPlugin } from '@moxxy/plugin-provider-anthropic';

session.pluginHost.registerStatic(anthropicPlugin);
session.providers.setActive('anthropic');
```

## Auth

```sh
export ANTHROPIC_API_KEY=sk-ant-...
```

Or via vault placeholder in `moxxy.config.ts`:

```ts
provider: {
  name: 'anthropic',
  model: 'claude-sonnet-5',
  config: { apiKey: '${vault:ANTHROPIC_API_KEY}' },
}
```

## Exports

- `anthropicPlugin`, `anthropicProviderDef`
- `AnthropicProvider`, `AnthropicProviderConfig`, `anthropicModels`
- `toAnthropicMessages`, `toAnthropicTools` — translation helpers
- `validateKey(key)` — synchronous-ish key check used by `moxxy doctor --check-keys`
