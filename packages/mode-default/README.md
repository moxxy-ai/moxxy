# @moxxy/mode-default

The **default loop strategy** (mode) for [moxxy](https://moxxy.ai) — a Claude
Code-style ReAct loop: the agent thinks, optionally calls tools, sees the
results, and continues until it produces a final answer. It also handles
retryable provider errors (e.g. 429s) with backoff.

A "mode" is the turn-by-turn brain of a moxxy [`Session`](https://www.npmjs.com/package/@moxxy/core);
register this one to get sensible default agent behaviour, or author your own
against `@moxxy/sdk`'s `defineMode`.

## Install

```bash
npm i @moxxy/core @moxxy/sdk @moxxy/mode-default
```

## Usage

```ts
import { Session, collectTurn, autoAllowResolver } from '@moxxy/core';
import defaultModePlugin from '@moxxy/mode-default';
import openaiPlugin from '@moxxy/plugin-provider-openai';

const session = new Session({ cwd: process.cwd(), permissionResolver: autoAllowResolver });

session.pluginHost.registerStatic(defaultModePlugin); // ← the loop strategy
session.pluginHost.registerStatic(openaiPlugin);
session.providers.setActive('openai', { apiKey: process.env.OPENAI_API_KEY });

const events = await collectTurn(session, 'What is 2+2? Use a tool if you have one.');
```

The mode is selected automatically once registered (it registers as the default).
To run a different strategy, register another mode package and switch with
`session.modes.setActive(name)`.

## Exports

- `default` / `defaultModePlugin` — the moxxy plugin to register.
- `defaultMode` — the underlying `Mode` (if you compose registries yourself).
- `DEFAULT_MODE_NAME` — its registered name.

## License

MIT
