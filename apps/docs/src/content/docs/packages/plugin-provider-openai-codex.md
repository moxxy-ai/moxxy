---
title: '@moxxy/plugin-provider-openai-codex'
description: ChatGPT Pro/Plus backed provider — OAuth, no API key.
---

`@moxxy/plugin-provider-openai-codex` is the LLM provider for the
ChatGPT-plan Codex backend. Auth is the user's ChatGPT Pro/Plus
account via OAuth (PKCE loopback or device-code); the rest of the
request body is the OpenAI Responses API shape.

## Install

```sh
pnpm add @moxxy/plugin-provider-openai-codex
```

## Sign in

```sh
moxxy login openai-codex
# Opens your browser, listens on http://localhost:8765/callback,
# exchanges the code, stores tokens in the vault.
```

`--no-browser` (or a non-TTY stdin) forces device-code flow.

## Use

```ts
import { openaiCodexPlugin } from '@moxxy/plugin-provider-openai-codex';

session.pluginHost.registerStatic(openaiCodexPlugin);
session.providers.setActive('openai-codex');
```

In `moxxy.config.ts`:

```ts
provider: {
  name: 'openai-codex',
  model: 'codex-1', // see DEFAULT_CODEX_MODEL
}
```

## Token rotation

Refresh tokens rotate on every refresh (single-use). The provider's
`onTokensRefreshed` callback writes the new bundle back to the vault
before the next API call goes out — the CLI's setup wires this for you.

## Exports

- `openaiCodexPlugin`, `openaiCodexProviderDef`
- `CodexProvider`, `CodexProviderConfig`
- `codexModels`, `DEFAULT_CODEX_MODEL`
- `codexOauthProfile`, `CODEX_PROVIDER_ID` — `OAuthProviderProfile` consumed
  by `@moxxy/plugin-oauth`'s `runOauthLogin` / `ensureFreshTokens`
- OAuth helpers (`CLIENT_ID`, `ISSUER`, `AUTHORIZE_URL`, `TOKEN_URL`,
  `CODEX_RESPONSES_URL`, `DEFAULT_CALLBACK_PORT`, `DEFAULT_REDIRECT_PATH`,
  `DEFAULT_REDIRECT_URI`, `SCOPES`, `ORIGINATOR`, `generatePKCE`,
  `generateState`, `buildAuthorizeUrl`, `parseJwtClaims`,
  `extractAccountId`, `exchangeCodeForTokens`, `refreshTokens`)
- `toResponsesBody`, `toResponsesInput`, `toResponsesTools` — translators
- `codexLogin`, `codexLogout`, `codexStatus` — the `auth` hooks
- `readStoredTokens`, `persistCodexTokens`, `ensureFreshCodexTokens` — vault
  helpers in the `CodexTokens` shape (delegate to `@moxxy/plugin-oauth`'s
  generic storage under `oauth/openai-codex/*`)

## See also

- [Provider OAuth login guide](../guides/provider-oauth-login.md).
- [@moxxy/plugin-oauth](./plugin-oauth.md) — the generic OAuth client.
