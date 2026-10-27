# @moxxy/plugin-provider-openai

The **OpenAI** `LLMProvider` for [moxxy](https://moxxy.ai) — streams Responses
with function calls and translates moxxy's `ProviderRequest`/event
shape ↔ the OpenAI wire format. Register it into a
[`Session`](https://www.npmjs.com/package/@moxxy/core) to route turns to OpenAI.

Responses requests are stateless (`store: false`); Moxxy replays its own history,
including encrypted reasoning when supplied by the provider. The adapter also
supports Chat Completions for compatible endpoints.

OpenAI's own address (no `baseURL`, or `api.openai.com`) always uses Responses.
Any other endpoint (xAI, Google, local servers such as Ollama, runtime-added
vendors, `openai` behind a proxy) tries Responses first and, when the server
has no Responses route (HTTP 404/405, not a missing model), answers the same
request over Chat Completions and stays there for that client. Other errors
surface unchanged. Z.ai is pinned to Chat Completions, the only protocol it
documents. Set `api` to pin a protocol for an endpoint the automatic choice
gets wrong.

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
  // model: 'gpt-6-sol',        // optional — defaults to gpt-5.6-luna
});

console.log((await collectTurn(session, 'Hello!')).findLast((e) => e.type === 'assistant_message')?.content);
```

### Point at an OpenAI-compatible vendor

```ts
session.providers.setActive('openai', {
  apiKey: process.env.GROQ_API_KEY,
  baseURL: 'https://api.groq.com/openai/v1',
  // api: 'chat-completions', // only to pin a protocol; unset tries Responses first
  // model: '...'   // the vendor's model id
});
```

## Config (`OpenAIProviderConfig`)

| field | meaning |
|---|---|
| `apiKey` | the API key (or wire it through the Session's `secretResolver`) |
| `api` | pin `responses` or `chat-completions`; unset: Responses on OpenAI, otherwise Responses with Chat Completions fallback |
| `baseURL` | override the API base for an OpenAI-compatible vendor |
| `model` / `models` | pick / override the advertised model catalog |

## Exports

`default` / `openaiPlugin` (register this), `openaiProviderDef`, `OpenAIProvider`,
`openAIModels`, `validateKey`, and `defineOpenAICompatProvider` (build a provider
for another OpenAI-compatible vendor in a few lines).

`GptLiveSessionClient` negotiates official GPT-Live WebRTC sessions with a
server-held API key. The desktop's Voice flow is documented in
[`docs/voice-gpt-live.md`](../../docs/voice-gpt-live.md).

## License

MIT
