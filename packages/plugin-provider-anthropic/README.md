# @moxxy/plugin-provider-anthropic

The **Anthropic (Claude)** `LLMProvider` for [moxxy](https://moxxy.ai) — streams
the Messages API with tool use and adaptive extended thinking, and translates
moxxy's `ProviderRequest`/event shape ↔ the Anthropic wire format. Register it
into a [`Session`](https://www.npmjs.com/package/@moxxy/core) to route turns to
Claude.

## Install

```bash
npm i @moxxy/core @moxxy/sdk @moxxy/mode-default @moxxy/plugin-provider-anthropic
```

## Usage

```ts
import { Session, runTurn, autoAllowResolver } from '@moxxy/core';
import defaultModePlugin from '@moxxy/mode-default';
import anthropicPlugin from '@moxxy/plugin-provider-anthropic';

const session = new Session({ cwd: process.cwd(), permissionResolver: autoAllowResolver });
session.pluginHost.registerStatic(defaultModePlugin);
session.pluginHost.registerStatic(anthropicPlugin);

session.providers.setActive('anthropic', {
  apiKey: process.env.ANTHROPIC_API_KEY,
  // model: 'claude-opus-4-8',   // optional — defaults to the built-in catalog
});

for await (const e of runTurn(session, 'Write a haiku about TypeScript.')) {
  if (e.type === 'assistant_chunk') process.stdout.write(e.delta);
}
```

## Config

| field | meaning |
|---|---|
| `apiKey` | your Anthropic API key (or wire it through the Session's `secretResolver`) |
| `model` / `models` | pick / override the advertised model catalog |

Mix it with [`@moxxy/plugin-provider-openai`](https://www.npmjs.com/package/@moxxy/plugin-provider-openai):
register both and `setActive('anthropic' | 'openai', …)` to switch vendors per
turn.

## Exports

`default` / `anthropicPlugin` (register this), `anthropicProviderDef`,
`AnthropicProvider`, `anthropicModels`, `validateKey`.

## License

MIT
