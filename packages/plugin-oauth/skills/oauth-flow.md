---
name: oauth-flow
description: Obtain and reuse OAuth 2.0 tokens for any provider via `oauth_authorize` / `oauth_get_token` / `oauth_clear_token`.
triggers:
  - "oauth"
  - "authorize with"
  - "sign in to"
  - "log in to"
  - "connect to"
  - "authenticate with"
  - "get a token for"
  - "google workspace"
  - "google drive"
  - "google calendar"
  - "gmail"
  - "github api"
  - "notion api"
allowed-tools:
  - oauth_authorize
  - oauth_get_token
  - oauth_clear_token
---

# OAuth (generic)

This plugin runs the OAuth 2.0 authorization-code-with-PKCE dance
(loopback flow), or the RFC 8628 device-code flow for headless hosts.
Tokens persist in the user's vault under `oauth/<provider>/*`; the
`oauth_get_token` tool transparently refreshes when expired.

## When to use

- The user asks to connect / authorize / sign in to some third-party
  API (Google Workspace, GitHub, Notion, Linear, Spotify, …).
- A downstream tool / MCP server needs a bearer token to call that API
  on the user's behalf.

If the user just wants to read a public page → `web_fetch` is simpler.
OAuth is for authenticated user-owned data.

## Flow

### Step 1 — confirm the user has an OAuth client registered

Every provider requires the user to register an OAuth app and give
you a `client_id` (and sometimes a `client_secret`). If the user
doesn't have one, send them to the provider's developer console and
tell them the exact redirect URI to register:

- Loopback mode (default): `http://localhost:8765/callback`
- Device mode: no redirect URI needed.

### Step 2 — call `oauth_authorize`

```
oauth_authorize({
  provider: "github",
  authUrl: "https://github.com/login/oauth/authorize",
  tokenUrl: "https://github.com/login/oauth/access_token",
  clientId: "<the user's client id>",
  scopes: ["repo", "read:user"],
  // clientSecret only for confidential clients (most server apps);
  // omit for native/installed apps relying on PKCE alone.
})
```

The plugin will:
1. Generate PKCE codes + a CSRF state.
2. Start a local server on `http://localhost:8765/callback`.
3. Open the user's browser to the authorization URL.
4. Wait for the redirect, exchange the code for tokens.
5. Store tokens in `oauth/github/*` (vault).

The tool returns when the user finishes — usually under 30 seconds.

### Step 3 — use the token

```
oauth_get_token({ provider: "github" })
// → { accessToken: "ghp_…", tokenType: "Bearer", expiresAt: 1234567890, scope: "repo read:user" }
```

Now pass `Authorization: Bearer <accessToken>` to whatever tool needs
to call the API. If the cached token expired, this call refreshes it
silently via the stored `refresh_token` before returning.

### Step 4 — re-auth on scope changes / revoke

```
oauth_clear_token({ provider: "github" })   // wipes vault
oauth_authorize({ provider: "github", scopes: ["repo", "read:user", "user:email"], ... })
```

## Headless mode (no browser available)

For SSH sessions, CI containers, kiosks etc. — set `mode: "device"`
and pass the provider's device-authorization endpoint:

```
oauth_authorize({
  provider: "google",
  deviceUrl: "https://oauth2.googleapis.com/device/code",
  tokenUrl: "https://oauth2.googleapis.com/token",
  clientId: "...",
  scopes: [...],
  mode: "device",
})
```

The user sees a short code + URL printed; they open it on any device
(phone, laptop), type the code, approve. The flow returns when done.

If the provider has no device flow → use loopback but set
`noOpen: true`. The auth URL is printed for the user to open
manually — works if they can SSH-tunnel port 8765 back to their
laptop, or if they're sitting at the same machine.

## Don't

- **Don't paste tokens into chat.** They live in the vault; reference
  by provider name via `oauth_get_token`. The model never needs to
  see the raw token in scrollback.
- **Don't hardcode `clientId` / `clientSecret`.** Ask the user once,
  use the values, and rely on the vault to remember them for next
  time (the plugin stores them alongside the token).
- **Don't choose scopes the user didn't ask for.** Request the
  minimum needed to do the immediate task; revisit with
  `oauth_clear_token` + a fresh `oauth_authorize` if you need more
  later.
- **Don't invent endpoint URLs.** If the user names a provider you
  don't have URLs for, ask — guessing OAuth endpoints leads to
  hard-to-diagnose 404s.
