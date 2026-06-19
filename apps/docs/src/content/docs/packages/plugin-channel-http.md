---
title: '@moxxy/plugin-channel-http'
description: Request-response HTTP channel — POST /v1/turn + SSE streaming + bearer auth.
---

`@moxxy/plugin-channel-http` exposes a moxxy `Session` over HTTP.
There's no human in the loop, so permissions are a static allow-list
declared up-front; auth is a bearer token.

## Install

```sh
pnpm add @moxxy/plugin-channel-http
```

## Start

```ts
import { httpChannelPlugin } from '@moxxy/plugin-channel-http';

session.pluginHost.registerStatic(httpChannelPlugin);
session.channels.setActive('http');
```

Or via the CLI:

```sh
export MOXXY_HTTP_TOKEN=$(openssl rand -hex 32)
moxxy channels http
```

## Endpoints

| Method | Path | Body | Response |
|---|---|---|---|
| `GET` | `/v1/health` | — | `{ "status": "ok" }` |
| `POST` | `/v1/turn` | `{ prompt, model?, systemPrompt? }` | `{ events: MoxxyEvent[], assistant: string }` |
| `POST` | `/v1/turn/stream` | same | SSE — one `data:` line per `MoxxyEvent`, terminating with `data: [DONE]` |

`turnRequestSchema` is exported for typed clients.

## Config

```ts
// moxxy.config.ts
channels: {
  http: {
    port: 3737,                // default
    host: '127.0.0.1',         // default
    authToken: '${vault:MOXXY_HTTP_TOKEN}',
    allowedTools: ['Read', 'Glob', 'Grep', 'web_fetch'],
  },
}
```

`allowedTools` is required — the channel's `isAvailable` refuses to
boot without it (there's no human to click "allow"). Pass `[]` to
disable all tools.

## Exports

- `HttpChannel`, `HttpChannelOptions`, `HttpStartOpts`
- `httpChannelDef`, `httpChannelPlugin`
- `routeRequest`, `handleHealth`, `handleTurn`, `handleTurnStream`
- `turnRequestSchema`, `TurnRequest`, `RouterContext`, `RouteHandler`

## See also

- [HTTP channel guide](../guides/http-channel.md) — auth, SSE, deployment.
- [Running as a service](../guides/running-as-a-service.md) — install as launchd / systemd.
