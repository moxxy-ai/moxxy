# @moxxy/plugin-provider-claude-code

## 0.1.2

### Patch Changes

- Updated dependencies [b928391]
  - @moxxy/sdk@0.5.1
  - @moxxy/plugin-oauth@0.0.7
  - @moxxy/plugin-provider-anthropic@0.1.1

## 0.1.1

### Patch Changes

- fad9d6b: Make `moxxy login claude-code` resilient to Anthropic's transient OAuth 500s.

  Anthropic's OAuth endpoints (`claude.ai/oauth/authorize` and the
  `console.anthropic.com/v1/oauth/token` exchange) intermittently return an
  `Internal server error` on the first hit — the identical request then succeeds
  on retry. The token-exchange 500 previously aborted the whole sign-in, forcing
  a full browser re-auth. `postClaudeToken` now retries transient failures
  (5xx / 429 / network errors) up to 3 attempts with a short backoff, while
  deterministic 4xx (bad/expired/already-used code, `invalid_grant`) still surface
  immediately. On exhaustion the error carries an actionable "wait and re-run"
  hint instead of a raw API dump. The browser sign-in instructions also note that
  the authorize page may need a "Try again" click on the first attempt.

## 0.1.0

### Minor Changes

- ad26425: Add a `claude-code` provider so Claude Pro/Max subscribers can use moxxy with
  their subscription instead of a pay-as-you-go API key.

  - New `@moxxy/plugin-provider-claude-code`: talks to the standard Anthropic
    Messages API with a Claude Code OAuth bearer token (`anthropic-beta:
oauth-2025-04-20` + the required "You are Claude Code…" system preamble).
  - Two ways to authenticate: paste a token from `claude setup-token` (or set
    `CLAUDE_CODE_OAUTH_TOKEN`), or run `moxxy login claude-code` for an
    interactive out-of-band OAuth sign-in. Access tokens refresh automatically.
  - `@moxxy/plugin-provider-anthropic`: `AnthropicProvider` gained an OAuth mode
    (bearer auth + system preamble + refresh-on-401); the API-key path is
    unchanged.
  - `@moxxy/sdk`: `ProviderAuthContext` gained an optional `prompt()` so auth
    flows can ask the user to paste a code/token (used by the out-of-band flow).

### Patch Changes

- Updated dependencies [ad26425]
- Updated dependencies [e64aa0e]
  - @moxxy/plugin-provider-anthropic@0.1.0
  - @moxxy/sdk@0.5.0
  - @moxxy/plugin-oauth@0.0.6
