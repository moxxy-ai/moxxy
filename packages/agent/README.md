# @moxxy/agent

The fastest way to run a [moxxy](https://moxxy.ai) agent — **one install, one
call.** Batteries included: it bundles the runtime (`@moxxy/core`), the default
loop, and the OpenAI + Anthropic providers behind drop-in presets.

```bash
npm i @moxxy/agent
```

## Hello, agent

```ts
import { setupAgent, openaiPreset } from '@moxxy/agent';

const { ask } = setupAgent(openaiPreset({ apiKey: process.env.OPENAI_API_KEY }));

console.log(await ask('Write a haiku about TypeScript.'));
```

Stream the events instead:

```ts
const { stream } = setupAgent(openaiPreset({ apiKey: process.env.OPENAI_API_KEY }));

for await (const event of stream('Explain async generators.')) {
  if (event.type === 'assistant_chunk') process.stdout.write(event.delta);
}
```

## Claude, or both

```ts
import { setupAgent, openaiPreset, anthropicPreset } from '@moxxy/agent';

// Just Claude:
const claude = setupAgent(anthropicPreset({ apiKey: process.env.ANTHROPIC_API_KEY }));

// Or register both and switch per turn (the first preset is active):
const agent = setupAgent([
  openaiPreset({ apiKey: process.env.OPENAI_API_KEY }),
  anthropicPreset({ apiKey: process.env.ANTHROPIC_API_KEY }),
]);
await agent.ask('Hi from OpenAI');
agent.setProvider('anthropic');
await agent.ask('Now from Claude');
```

## Add tools, swap blocks live

```ts
import { setupAgent, openaiPreset } from '@moxxy/agent';
import { defineTool } from '@moxxy/sdk';
import { z } from 'zod';

const agent = setupAgent(openaiPreset({ apiKey: process.env.OPENAI_API_KEY }));

agent.addTool(
  defineTool({
    name: 'get_weather',
    description: 'Current weather for a city.',
    inputSchema: z.object({ city: z.string() }),
    handler: async ({ city }) => `Sunny in ${city}.`,
  }),
);

console.log(await agent.ask("What's the weather in Paris?"));
```

`agent.session` is the live moxxy [`Session`](https://www.npmjs.com/package/@moxxy/core)
— full control for anything the sugar doesn't cover.

## Presets

| preset | options |
|---|---|
| `openaiPreset(opts?)` | `apiKey` (→ `OPENAI_API_KEY`), `model`, `baseURL` (OpenAI-compatible vendors: z.ai/xAI/Google/Ollama) |
| `anthropicPreset(opts?)` | `apiKey` (→ `ANTHROPIC_API_KEY`), `model` |

Need more control or a different provider/mode? Drop down to
[`@moxxy/core`](https://www.npmjs.com/package/@moxxy/core)'s `setupAgent({ plugins, provider, tools, … })`
and register any blocks you like — `@moxxy/agent` re-exports `setupAgent` and all
its types.

## License

MIT
