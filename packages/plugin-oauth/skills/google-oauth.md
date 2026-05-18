---
name: google-oauth
description: Set up Google OAuth (Gmail, Calendar, Drive, Docs, Sheets) and stash a refresh-capable token for Google Workspace MCP / direct API access.
triggers:
  - "google workspace"
  - "google oauth"
  - "google api"
  - "gmail"
  - "google calendar"
  - "google drive"
  - "google docs"
  - "google sheets"
  - "google contacts"
  - "google workspace mcp"
  - "enable gmail"
  - "connect gmail"
  - "connect google"
  - "sign in to google"
allowed-tools:
  - oauth_authorize
  - oauth_get_token
  - oauth_clear_token
  - install_plugin
  - mcp_add_server
---

# Google OAuth (for Workspace + direct API access)

Google requires extra ceremony vs other providers: a registered OAuth
client in Google Cloud Console, an exact-match redirect URI, and the
`access_type=offline` + `prompt=consent` params to actually receive a
refresh_token. This skill walks through both halves.

## Step 1 — Google Cloud Console setup (one-time, user does this)

Tell the user:

> Go to https://console.cloud.google.com/apis/credentials. Either pick
> an existing project or create a new one (any name).
>
> 1. **Enable the APIs you need** under *APIs & Services → Library*.
>    For Workspace MCP that means at minimum: Gmail API, Calendar API,
>    Drive API, Docs API, Sheets API.
>
> 2. **Configure the OAuth consent screen** if you haven't already:
>    *APIs & Services → OAuth consent screen*. Pick "External", give
>    it any name, list yourself as the only test user. Don't bother
>    submitting for verification — test mode is fine for personal use.
>
> 3. **Create credentials**: *APIs & Services → Credentials →
>    + Create credentials → OAuth client ID → Desktop app*. Name it
>    "moxxy" (or anything). Click Create.
>
> 4. **Add the redirect URI**: edit the new client, scroll to
>    *Authorized redirect URIs*, add EXACTLY:
>
>        http://localhost:8765/callback
>
>    Google rejects fuzzy matches — the port and path have to be exact.
>
> 5. Copy the **client_id** and **client_secret** values.

Wait for the user to come back with both values.

## Step 2 — run the OAuth flow

Pick scopes for what the user actually wants. Common combos:

| Use case               | Scopes                                                                              |
|------------------------|-------------------------------------------------------------------------------------|
| Gmail read+send        | `openid email profile https://www.googleapis.com/auth/gmail.modify`                 |
| Calendar full          | `openid email profile https://www.googleapis.com/auth/calendar`                     |
| Drive (read)           | `openid email profile https://www.googleapis.com/auth/drive.readonly`               |
| Drive (full)           | `openid email profile https://www.googleapis.com/auth/drive`                        |
| Docs + Sheets          | `https://www.googleapis.com/auth/documents https://www.googleapis.com/auth/spreadsheets` |
| Workspace MCP (broad)  | `openid email profile https://mail.google.com/ https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/documents https://www.googleapis.com/auth/spreadsheets` |

Then:

```
oauth_authorize({
  provider: "google",
  authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  clientId: "<from step 1>",
  clientSecret: "<from step 1>",
  scopes: [
    "openid",
    "email",
    "profile",
    "https://www.googleapis.com/auth/calendar",
    // ...whatever the user asked for
  ],
  extraAuthParams: {
    access_type: "offline",       // REQUIRED to receive refresh_token
    prompt: "consent",            // forces consent screen so refresh_token is reissued
    include_granted_scopes: "true" // optional: stacks new scopes onto existing grants
  },
})
```

The browser opens, the user picks their Google account, approves the
scopes, the local callback fires, and the tool returns with the
token summary. Tokens land in `oauth/google/*` in the vault.

## Step 3 — use it

For ad-hoc API calls:

```
oauth_get_token({ provider: "google" })
// → { accessToken, tokenType: "Bearer", expiresAt, scope }
```

For Google Workspace MCP (the most common follow-on):

```
# 1. Install the Workspace MCP server (if not already)
install_plugin({ packageName: "@moxxy/plugin-mcp" })   # if needed

# 2. Add the MCP server with the Google token
mcp_add_server({
  name: "google-workspace",
  command: "npx",
  args: ["-y", "@taylorwilsdon/google_workspace_mcp", "--transport", "stdio"],
  env: {
    GOOGLE_OAUTH_CLIENT_ID: "<from step 1>",
    GOOGLE_OAUTH_CLIENT_SECRET: "<from step 1>",
    // Some Workspace MCP servers accept a refresh_token directly:
    GOOGLE_OAUTH_REFRESH_TOKEN: "<grab from vault: oauth/google/refresh_token>"
  }
})
```

Then the model can call `mcp__google-workspace__*` tools directly.

## Headless variant

Google supports the device flow at
`https://oauth2.googleapis.com/device/code`. If the user is on SSH
or a headless host:

```
oauth_authorize({
  provider: "google",
  deviceUrl: "https://oauth2.googleapis.com/device/code",
  tokenUrl: "https://oauth2.googleapis.com/token",
  clientId: "...",
  clientSecret: "...",
  scopes: [...],
  mode: "device",
  extraAuthParams: { access_type: "offline" },
})
```

Print the user_code + verification_uri the tool surfaces; tell the
user to open it on their phone / laptop.

## Common failures

- **"redirect_uri_mismatch"** — exact URL match. Re-check that you
  added `http://localhost:8765/callback` (with port + `/callback`).
- **"access_denied"** — the user clicked Cancel on the consent screen,
  or their account isn't in the test-users list of an unverified app.
- **No `refresh_token` in the response** — happens when the user has
  already authorized the same scopes for this client; Google
  silently skips reissuing it. Fix: pass `prompt: "consent"` (which
  this skill always does) to force a fresh issuance.
- **403 on first API call after `oauth_get_token`** — the API isn't
  enabled in the Google Cloud project. Send the user back to
  *APIs & Services → Library* to enable it.

## Don't

- Don't request scopes the user didn't ask for. Each extra scope is
  one more thing on the consent screen and one more thing the user
  has to trust the local moxxy install with.
- Don't suggest the user manually paste tokens into env vars or
  config files. Vault is the durable store; `oauth_get_token`
  always reads from there.
- Don't recommend "external + production" on the consent screen for
  personal use — that puts the user on Google's review queue. Test
  mode (External + test users) is fine for single-user setups.
