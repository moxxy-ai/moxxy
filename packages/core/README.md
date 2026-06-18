# @moxxy/core

The [moxxy](https://moxxy.ai) runtime, as a library. Construct an agentic
**Session**, register the blocks you want (providers, tools, modes, compactors,
channels, …), and run turns — embed moxxy's agent loop directly in your own code
instead of going through the CLI or desktop app.

`@moxxy/core` is the **engine + the block registries**. It ships *no* built-in
LLM provider or loop strategy — those are swappable packages you register, so
nothing is welded in.

> **Just want to run an agent fast?** Use
> [`@moxxy/agent`](https://www.npmjs.com/package/@moxxy/agent) —
> `setupAgent(openaiPreset({ apiKey }))` and you're done. This package is the
> layer underneath, for when you want full control of the blocks.

## Install

```bash
npm i @moxxy/core @moxxy/sdk @moxxy/mode-default @moxxy/plugin-provider-openai
```

(`@moxxy/sdk` gives you the typed contracts + `define*` factories for authoring
your own blocks.)

## Quick start — `setupAgent`

`setupAgent` wires a Session + your blocks in one synchronous call and hands back
a small agent you destructure:

```ts
import { setupAgent } from '@moxxy/core';
import defaultMode from '@moxxy/mode-default';
import openai from '@moxxy/plugin-provider-openai';

const { ask, stream, session } = setupAgent({
  plugins: [defaultMode, openai],
  provider: { name: 'openai', config: { apiKey: process.env.OPENAI_API_KEY } },
});

// `ask` → the final reply text (async):
console.log(await ask('Say hello in French.'));

// `stream` → an async generator yielding each event:
for await (const event of stream('Now in German.')) {
  if (event.type === 'assistant_chunk') process.stdout.write(event.delta);
}
```

`collect(prompt)` resolves with every event; `session` is the live Session for
anything the sugar doesn't cover.

### Tools

```ts
import { defineTool } from '@moxxy/sdk';
import { z } from 'zod';

const { ask, addTool } = setupAgent({ plugins: [defaultMode, openai], provider: { name: 'openai' } });

addTool(
  defineTool({
    name: 'get_weather',
    description: 'Current weather for a city.',
    inputSchema: z.object({ city: z.string() }),
    handler: async ({ city }) => `It's sunny in ${city}.`,
  }),
);

console.log(await ask("What's the weather in Paris?"));
```

### Hot-swap blocks between turns

Nothing is hardcoded — the registries *are* the enable/disable/swap mechanism,
exposed as chainable sugar (and on `agent.session` directly):

```ts
agent.setProvider('anthropic', { apiKey: process.env.ANTHROPIC_API_KEY }); // swap LLM
agent.setMode('goal');                                                     // swap loop strategy
agent.removeTool('get_weather');
await agent.discover();                                                     // load npm plugins
```

## Under the hood (manual wiring)

`setupAgent` is sugar over the raw API, which you can use directly:

```ts
import { Session, runTurn, autoAllowResolver } from '@moxxy/core';

const session = new Session({ cwd: process.cwd(), permissionResolver: autoAllowResolver });
session.pluginHost.registerStatic(defaultMode);
session.pluginHost.registerStatic(openai);
session.providers.setActive('openai', { apiKey: process.env.OPENAI_API_KEY });

for await (const event of runTurn(session, 'Summarise the files in this repo.')) {
  // …
}
```

## What's in the box

`setupAgent` + `Session` + `runTurn`/`collectTurn` · the registries
(`ProviderRegistry`, `ToolRegistryImpl`, `ModeRegistry`, `CompactorRegistry`,
`CacheStrategyRegistry`, `ChannelRegistryImpl`, `EmbedderRegistry`, …) ·
`PluginHost` + plugin discovery/loading · `SessionPersistence` (save / resume) ·
the `PermissionEngine` + resolvers (`autoAllowResolver`, `denyByDefaultResolver`,
allow-list, callback) · the `EventLog` · skills · `createLogger`. The
`@moxxy/sdk` types in the public surface (`MoxxyEvent`, `Plugin`, `ToolDef`,
`PermissionResolver`, `RunTurnOptions`) are re-exported, so the API is fully
typed from a single import.

`packages/core/src/index.ts` is the curated public surface. The package is `0.x`:
the API may still change between minor versions while it settles.

## You bring the model

`@moxxy/core` is provider-agnostic: it defines the `LLMProvider` contract (in
`@moxxy/sdk`) but bundles no vendor. Register a provider plugin (or your own)
before running a turn.

## License

MIT
