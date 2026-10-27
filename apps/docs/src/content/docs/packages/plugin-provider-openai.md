---
title: '@moxxy/plugin-provider-openai'
description: OpenAI LLM provider for moxxy.
---

`@moxxy/plugin-provider-openai` is the OpenAI provider plugin.
API-key auth, the OpenAI model list, and streaming Responses API. Moxxy keeps
conversation state locally (`store: false`), including tool calls and encrypted reasoning.
Images and PDF inputs, cancellation, cached-token usage and parallel function calls are supported.

OpenAI's own API always uses Responses. Every other OpenAI-compatible server
(xAI, Google, Ollama and other local servers, providers you add, or `openai`
behind your own address) tries Responses first; when the server has no
Responses route (HTTP 404/405), Moxxy answers the same request over Chat
Completions and keeps using it. Other errors are shown as they are. Z.ai stays
on Chat Completions. To pin one protocol for an unusual server, set
`api: "responses"` or `api: "chat-completions"` in that provider's config.

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
  model: 'gpt-5.6-luna',
  config: { apiKey: '${vault:OPENAI_API_KEY}' },
}
```

## Exports

- `openaiPlugin`, `openaiProviderDef`
- `OpenAIProvider`, `OpenAIProviderConfig`, `openAIModels`
- `toOpenAIMessages`, `toOpenAITools` — translation helpers
- `validateKey(key)` — used by `moxxy doctor --check-keys`

## See also

- To work on your ChatGPT sign-in, use `@moxxy/plugin-provider-codex-agent`: your installed Codex runs each turn.
- GPT-Live and OpenAI transcription use `OPENAI_API_KEY`, independently of a ChatGPT plan.
