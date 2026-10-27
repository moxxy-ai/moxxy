---
title: '@moxxy/plugin-oauth'
description: Generic OAuth 2.0 + PKCE + device-code client. Powers `moxxy login` for any provider.
---

`@moxxy/plugin-oauth` is a generic OAuth 2.0 client with PKCE and
RFC 8628 device-code support. Integrations that implement an OAuth profile
delegate their `auth.login` to it; the `moxxy login` CLI command
discovers them automatically.

## Install

```sh
pnpm add @moxxy/plugin-oauth
```

## Build

```ts
import { buildOauthPlugin } from '@moxxy/plugin-oauth';

const plugin = buildOauthPlugin({ vault });
session.pluginHost.registerStatic(plugin);
```

## Tools

| Tool | Purpose |
|---|---|
| `oauth_authorize` | Run the loopback (port 8765) or device-code flow for a provider. |
| `oauth_get_token` | Fetch / refresh the current access token. |
| `oauth_clear_token` | Drop stored credentials. |

## Programmatic surface

```ts
import {
  buildAuthUrl,
  runAuthorizationCodeFlow,
  runDeviceCodeFlow,
  refreshAccessToken,
  computeCodeChallenge,
  generateCodeVerifier,
  generateState,
  readStoredCreds,
  storeTokenSet,
  clearStoredCreds,
} from '@moxxy/plugin-oauth';
```

A provider plugin's `auth.login` typically just imports these helpers
and wraps them with the provider's specific authorize URL + token URL.
Agent connections use their installed CLI's own sign-in; this generic OAuth service is for other integrations.

## Storage

Tokens persist under `oauth/<provider>/*` in the vault, so subsequent
sessions inherit them. Refresh tokens that rotate on every refresh
(single-use) require the provider's `onTokensRefreshed` callback to
write the new bundle back before the next API call goes out.

## Flows

- **Loopback (default)**: opens the user's browser to the authorize URL,
  spins up a tiny HTTP server on `http://localhost:8765/callback`,
  receives the code, exchanges it for tokens.
- **Device-code (RFC 8628)**: triggered by `--no-browser` or non-TTY
  stdin. Shows the user a code + verification URL; polls the token
  endpoint until they complete the flow on another device.

## Skills

The plugin ships bundled Markdown skills that explain when to use it
and walk through provider-side setup (e.g. Google Cloud Console for
Workspace OAuth).
