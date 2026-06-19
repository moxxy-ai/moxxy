---
title: Webhooks
description: Wire any external system to fire a prompt — verified, filtered, optionally auto-tunneled.
---

`@moxxy/plugin-webhooks` lets an external system (any service that
emits HTTP webhooks) wake the agent. The plugin is fully generic — no
GitHub/Stripe wrappers — so the same setup works for a payment
processor, a source forge, a CI runner, or your own internal service.
The agent handles vendor specifics conversationally via `webhook_setup_guide`.

## The 30-second flow

```
You:  set up a webhook for issue events from <my system>
Agent: [calls webhook_setup_guide — gets a 9-step script]
Agent: where will the events come from? (this just names the trigger)
You:  github-issues
Agent: do you already have a public URL or should I spawn one?
You:  spawn one
Agent: [calls webhook_tunnel_start → cloudflared, returns the URL]
Agent: how does the source sign requests? (bearer / hmac / none)
You:  hmac with X-Hub-Signature-256, prefix sha256=
Agent: do you already have the secret or should I generate one?
You:  generate one
Agent: which event types should fire vs. ignore?
You:  fire on issues.opened only
Agent: what should I do per delivery, and which tools should I have?
You:  triage and email me. allow Bash + web_fetch.
Agent: [calls webhook_create]
Agent: paste this URL + secret into the source's webhook config:
       URL: https://<random>.trycloudflare.com/webhook/01HX…
       Secret: a3f7…b921 (record now — won't be shown again)
```

The setup tool returns the full step-by-step script as data — your
prompt just relays it. No vendor-specific code in moxxy.

## Verification schemes

| Scheme | Use when | Config |
|---|---|---|
| `none` | Local-only testing. Anyone with the URL fires the trigger. | `{ type: 'none' }` |
| `bearer` | Source sends a static token in `Authorization: Bearer …`. | `{ type: 'bearer', secret }` |
| `hmac` (plain) | Source signs the body with HMAC. Header carries the digest. | `{ type: 'hmac', secret, signatureHeader, algorithm, prefix?, scheme: 'plain' }` |
| `hmac` (stripe-style) | Header is `t=<ts>,v1=<sig>`, HMAC input is `<ts>.<body>`. | `{ type: 'hmac', …, scheme: 'stripe', timestampToleranceSec }` |

Signature comparisons run constant-time. Stripe-style verifications
also reject deliveries whose timestamp drifts past tolerance.

## Filters

`include` (any-of) and `exclude` (drop-if-any) rules narrow which
verified deliveries fire the prompt. Each rule reads ONE field:

- `source: 'header'` — request header value (case-insensitive)
- `source: 'jsonPath'` — dot-separated path in the JSON body
  (`action`, `pull_request.user.login`)

Compare with `equals: [...]` (any-of, string-coerced) or `matches:
"regex"`.

Example — only fire on opened issues, never on closed PRs:

```ts
filters: {
  include: [
    { source: 'header', name: 'x-event', equals: ['issues'] },
    { source: 'jsonPath', path: 'action', equals: ['opened'] },
  ],
  exclude: [
    { source: 'jsonPath', path: 'pull_request.merged', equals: ['true'] },
  ],
}
```

## Idempotency

Webhook providers retry. Set `idempotencyHeader` to a delivery-id
header (`X-Delivery-Id`, `X-Event-Id`, etc.) and duplicate deliveries
get dropped silently. The dedupe cache is in-memory (per process); a
restart resets it, but that's rarely an issue in practice.

## Outcomes

Every fired prompt writes a Markdown record to
`~/.moxxy/inbox/webhooks/<timestamp>-<trigger-name>.md` with the final
assistant message (or the error). Plug an `onFired` callback into
`buildWebhooksPlugin` to also pipe outcomes to Telegram or another
channel.

## Public URL

External providers can't reach localhost. Three paths:

```sh
# Option 1 — free cloudflared tunnel, no signup
# (via the agent: webhook_tunnel_start)
brew install cloudflared             # macOS; Linux: github.com/cloudflare/cloudflared/releases

# Option 2 — bring your own URL (Tailscale Funnel, reverse proxy, …)
# (via the agent: webhook_set_public_url https://your-host.example)

# Option 3 — keep it local (verification: none) for testing
```

## Running 24/7

The webhook listener auto-starts whenever any moxxy session boots,
because the plugin's `onInit` hook spins up the HTTP server. To keep
that session alive across reboots:

```sh
moxxy serve --background           # one process: every channel + scheduler + webhooks
# or, just webhooks + scheduler if you don't want channels:
moxxy serve --background --except telegram,http
```

See [Running as a service](./running-as-a-service.md) for the full
catalog.

## Testing without a real source

```sh
# Inside the TUI, ask the agent:
# "fire trigger gh-issues with body {\"action\":\"opened\"} and header x-event=issues"
# The agent calls webhook_test, which bypasses HTTP + verification but
# still evaluates filters and runs the prompt.
```

## Caveats

- **Verification is non-optional in production.** `verification: 'none'`
  means anyone on the internet who finds the URL fires your agent
  with whatever tools you allowed.
- **Quick tunnels are ephemeral.** A cloudflared `trycloudflare.com`
  URL lives only as long as the process. For stable URLs, use a named
  cloudflared tunnel, Tailscale Funnel, or a deployed reverse proxy
  and call `webhook_set_public_url`.
- **Filters are best-effort.** A malformed JSON body skips JSON-path
  rules silently (treated as no-match). If you need stricter filtering,
  reject in the prompt itself.
