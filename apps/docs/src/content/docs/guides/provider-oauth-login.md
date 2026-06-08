---
title: Provider OAuth login
description: moxxy login openai-codex — and how the generic OAuth plugin powers it.
---

Most providers use API keys. Two providers use a **subscription** instead:
`openai-codex` (`@moxxy/plugin-provider-openai-codex`) for ChatGPT Pro/Plus,
and `claude-code` (`@moxxy/plugin-provider-claude-code`) for Claude Pro/Max.
The generic `@moxxy/plugin-oauth` plugin handles the dance for any provider
that wires the same hook.

## Log in

```sh
moxxy login openai-codex
# Opens your browser, listens on http://localhost:8765/callback,
# exchanges the code for tokens, stores them in the vault.
```

`moxxy login` is generic: it walks the provider registry and any
`ProviderDef` with `auth: { kind: 'oauth' }` becomes loggable. There's
no provider-specific code in the CLI — the plugin owns the flow.

| Command | Effect |
|---|---|
| `moxxy login <provider>` | Run the login flow. |
| `moxxy login status [<provider>]` | Show stored creds (no secrets printed). |
| `moxxy login logout <provider>` | Remove stored creds. |
| `moxxy login --no-browser` | Force the headless device-code flow. |

The `--no-browser` flag (or a non-TTY stdin) triggers RFC 8628 device-code
flow — useful when you're SSH'd into a box without a local browser. You
complete the flow on your laptop's browser; the daemon polls for the
token.

## How the Codex provider wires it

```ts
export const openaiCodexProviderDef = defineProvider({
  name: 'openai-codex',
  models: [...codexModels],
  createClient: (config) => new CodexProvider(config),
  auth: {
    kind: 'oauth',
    serviceName: 'ChatGPT Pro/Plus',
    login: codexLogin,
    logout: codexLogout,
    status: codexStatus,
  },
});
```

`codexLogin` (see `packages/plugin-provider-openai-codex/src/login.ts`)
uses helpers from `@moxxy/plugin-oauth` — PKCE generation, code
exchange, device-flow polling — and stores the resulting bundle in
the vault under `oauth/openai-codex/*`.

Refresh tokens rotate on every refresh (single-use), so the provider's
`onTokensRefreshed` callback writes the new bundle back to the vault
before the next API call goes out. Lose that and you get one 401 then
permanent failure.

## Claude (Pro/Max) subscription — `claude-code`

The `claude-code` provider talks to the **standard Anthropic Messages API**,
but authenticates with a Claude Code OAuth token (a subscription credential)
instead of an API key. Set it active with:

```yaml
# moxxy.config.yaml
provider:
  name: claude-code
```

Three ways to supply the token:

```sh
# 1. Paste a token from the Claude CLI (long-lived, ~1 year):
export CLAUDE_CODE_OAUTH_TOKEN="$(claude setup-token)"

# 2. Or store it interactively (also accepts a setup-token paste):
moxxy login claude-code            # press Enter to sign in via browser,
                                   # or paste a setup-token at the prompt

# 3. Or set ANTHROPIC_AUTH_TOKEN (the SDK's native bearer var).
```

Unlike codex, Claude's OAuth is **out-of-band**: `moxxy login claude-code`
opens your browser, you approve, then copy the `code#state` string back into
the terminal (there's no loopback server). Tokens from the browser flow carry
a refresh_token and renew automatically; a pasted `setup-token` is long-lived
and simply re-run when it eventually expires.

Under the hood the request adds `anthropic-beta: oauth-2025-04-20` and leads
the system prompt with the Claude Code identity line — both required for the
API to accept a subscription token.

> **Heads-up:** Anthropic's consumer terms intend subscription tokens for
> official Claude clients. Use this with that in mind.

## Using OAuth in your own plugin

The `@moxxy/plugin-oauth` plugin contributes three tools:

| Tool | Purpose |
|---|---|
| `oauth_authorize` | Run the loopback or device-code flow for a configured provider. |
| `oauth_get_token` | Fetch / refresh the current access token. |
| `oauth_clear_token` | Drop stored creds. |

…and exports the same helpers (`runAuthorizationCodeFlow`,
`runDeviceCodeFlow`, `refreshAccessToken`, `computeCodeChallenge`,
`generateCodeVerifier`, `generateState`) so a provider plugin can call
them directly without going through the model.

Tokens persist under `oauth/<provider>/*` in the vault, so subsequent
sessions inherit them. The plugin's bundled skills explain the
provider-side setup (e.g. Google Cloud Console for Workspace OAuth).
