---
title: '@moxxy/plugin-webhooks'
description: Generic external-event triggers. Verified HTTP listener + filters + automatic tunnel.
---

`@moxxy/plugin-webhooks` lets an external system (any service that
emits HTTP webhooks — payment processors, source forges, CI runners,
internal services, …) wake the agent and run a prompt when an event
fires. The plugin is intentionally provider-agnostic: it ships no
GitHub/Stripe adapters, no vendor lock-in. The agent walks the user
through the source-specific bits (header names, signing scheme,
filters) via a setup-guide tool.

## What it gives you

- **HTTP listener** on its own port (default `3738`, separate from the
  HTTP channel) with one route: `POST /webhook/:triggerId`.
- **Persistent triggers** at `~/.moxxy/webhooks.json` — name, prompt,
  allowed tools, verification config, filters.
- **Verification schemes**: `none` (local-only), `bearer` (token in
  `Authorization` header), `hmac` (signature header — plain HMAC or
  Stripe-style `t=<ts>,v1=<sig>` with timestamp tolerance).
- **Filters** (`include` / `exclude` rules over headers or JSON body
  paths) so a verified delivery still only fires when it matches.
- **Idempotency** via a configurable delivery-id header — duplicate
  retries are dropped.
- **Tunnel helper** — spawns a free `cloudflared` (no signup) or
  `ngrok` quick tunnel and persists the public URL automatically.

## Install

```sh
pnpm add @moxxy/plugin-webhooks
```

The `@moxxy/cli` binary registers this for you. Embedders use
`buildWebhooksPlugin`:

```ts
import { buildWebhooksPlugin } from '@moxxy/plugin-webhooks';

const { plugin, store, config, dispatcher, stop } = buildWebhooksPlugin({
  runner: {
    runPrompt: async ({ prompt, allowedTools, model, triggerName }) => {
      // Bootstrap an isolated session, run the prompt, return { text, error? }.
    },
  },
  // optional:
  inbox: { dir: '~/.moxxy/inbox/webhooks' },
  onFired: (trigger, outcome) => { /* notify some channel */ },
});
session.pluginHost.registerStatic(plugin);
```

`stop()` shuts the listener (and any tunnel) without unloading the
plugin — used by `moxxy serve --except webhooks`.

## Tools (agent-facing)

| Tool | Purpose |
|---|---|
| `webhook_setup_guide` | Step-by-step interactive walkthrough. Agent-driven, vendor-neutral. |
| `webhook_create` | Create a trigger (auto-mints a secret if not supplied). |
| `webhook_list` | List triggers + URLs + fire history. Secrets never returned. |
| `webhook_update` | Toggle enable, edit prompt / filters / allowedTools. |
| `webhook_delete` | Permanently remove a trigger. |
| `webhook_test` | Fire synthetically (filters apply, verification skipped). |
| `webhook_status` | Listener, public URL, tunnel state, CLI availability. |
| `webhook_set_public_url` | Persist a URL the user already owns. |
| `webhook_clear_public_url` | Forget the URL. |
| `webhook_tunnel_start` | Spawn cloudflared (default) or ngrok and persist the URL. |
| `webhook_tunnel_stop` | Tear the tunnel down. |

## Trigger record

Each entry in `~/.moxxy/webhooks.json` is a `WebhookTrigger`:

```ts
{
  id: '01H…',              // ULID, used in the URL path
  name: 'gh-issues',
  prompt: 'Triage: {body_json}',
  allowedTools: ['Bash', 'web_fetch'],
  verification: {
    type: 'hmac',
    secret: '…',
    signatureHeader: 'X-Hub-Signature-256',
    algorithm: 'sha256',
    prefix: 'sha256=',
    scheme: 'plain',
    timestampToleranceSec: 300,
  },
  filters: {
    include: [{ source: 'header', name: 'x-github-event', equals: ['issues'] }],
    exclude: [{ source: 'jsonPath', path: 'action', equals: ['closed'] }],
  },
  idempotencyHeader: 'X-GitHub-Delivery',
  fireCount: 12,
  lastFiredAt: 1716060000000,
  // …
}
```

## Prompt placeholders

`webhook_create.prompt` accepts:
`{body}`, `{body_json}`, `{header.<name>}`, `{method}`, `{path}`,
`{trigger_name}`, `{fired_at}`.

Unknown placeholders are left intact.

## Public URL

External providers can't reach `localhost`. Three paths:

1. **Auto tunnel** (recommended for development) — `webhook_tunnel_start`
   spawns `cloudflared tunnel --url http://localhost:3738`. Free, no
   signup, parses the `*.trycloudflare.com` URL out of cloudflared's
   stdout and persists it.
2. **Manual URL** — `webhook_set_public_url https://your-host.example`
   if you already operate a tunnel / reverse proxy / Tailscale Funnel.
3. **No URL** — triggers are still saved; they just can't be reached
   until you set one.

## Storage

- Triggers: `~/.moxxy/webhooks.json` (atomic tmp + rename writes).
- Host config: `~/.moxxy/webhooks-config.json` (listener bind + public
  URL with provenance).
- Per-fire outcomes: `~/.moxxy/inbox/webhooks/<timestamp>-<name>.md`.

Override the root with `$MOXXY_HOME`.

## See also

- [Webhooks guide](../guides/webhooks) — end-to-end setup for a
  non-technical user.
- [Running as a service](../guides/running-as-a-service) — keep the
  listener alive across reboots via `moxxy serve --background`.
