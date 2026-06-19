---
title: '@moxxy/plugin-provider-openai'
description: OpenAI LLM provider for moxxy.
---

`@moxxy/plugin-provider-openai` is the OpenAI provider plugin.
API-key auth; ships the OpenAI model list.

## Install

```sh
pnpm add @moxxy/plugin-provider-openai
```

## Use

```ts
import { openaiPlugin } from '@moxxy/plugin-provider-openai';

session.pluginHost.registerStatic(openaiPlugin);
session.providers.setActive('openai');
```

## Auth

```sh
export OPENAI_API_KEY=sk-...
```

Or via vault placeholder:

```ts
provider: {
  name: 'openai',
  model: 'gpt-4o',
  config: { apiKey: '${vault:OPENAI_API_KEY}' },
}
```

## Exports

- `openaiPlugin`, `openaiProviderDef`
- `OpenAIProvider`, `OpenAIProviderConfig`, `openAIModels`
- `toOpenAIMessages`, `toOpenAITools` — translation helpers
- `validateKey(key)` — used by `moxxy doctor --check-keys`

## See also

- For ChatGPT Pro/Plus OAuth sign-in (no API key needed), use
  [@moxxy/plugin-provider-openai-codex](./plugin-provider-openai-codex.md).
