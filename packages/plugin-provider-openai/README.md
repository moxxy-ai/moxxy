# @moxxy/plugin-provider-openai

The **OpenAI** `LLMProvider` for [moxxy](https://moxxy.ai) — streams Chat
Completions with `tool_calls` and translates moxxy's `ProviderRequest`/event
shape ↔ the OpenAI wire format. Register it into a
[`Session`](https://www.npmjs.com/package/@moxxy/core) to route turns to OpenAI.

Because it speaks the OpenAI Chat Completions API, it also drives any
**OpenAI-compatible** endpoint (z.ai, xAI, Google's OpenAI shim, Ollama / local)
via the `baseURL` override.

## Install

```bash
npm i @moxxy/core @moxxy/sdk @moxxy/mode-default @moxxy/plugin-provider-openai
```

## Usage

```ts
import { Session, collectTurn, autoAllowResolver } from '@moxxy/core';
import defaultModePlugin from '@moxxy/mode-default';
import openaiPlugin from '@moxxy/plugin-provider-openai';

const session = new Session({ cwd: process.cwd(), permissionResolver: autoAllowResolver });
session.pluginHost.registerStatic(defaultModePlugin);
session.pluginHost.registerStatic(openaiPlugin);

session.providers.setActive('openai', {
  apiKey: process.env.OPENAI_API_KEY,
  // model: 'gpt-5.2',          // optional — defaults to the built-in catalog
});

console.log((await collectTurn(session, 'Hello!')).findLast((e) => e.type === 'assistant_message')?.content);
```

### Point at an OpenAI-compatible vendor

```ts
session.providers.setActive('openai', {
  apiKey: process.env.GROQ_API_KEY,
  baseURL: 'https://api.groq.com/openai/v1',
  // model: '...'   // the vendor's model id
});
```

## Config (`OpenAIProviderConfig`)

| field | meaning |
|---|---|
| `apiKey` | the API key (or wire it through the Session's `secretResolver`) |
| `baseURL` | override the API base for an OpenAI-compatible vendor |
| `model` / `models` | pick / override the advertised model catalog |

## Exports

`default` / `openaiPlugin` (register this), `openaiProviderDef`, `OpenAIProvider`,
`openAIModels`, `validateKey`, and `defineOpenAICompatProvider` (build a provider
for another OpenAI-compatible vendor in a few lines).

## License

MIT
