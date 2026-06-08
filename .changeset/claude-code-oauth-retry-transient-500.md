---
"@moxxy/plugin-provider-claude-code": patch
"@moxxy/cli": patch
---

Make `moxxy login claude-code` resilient to Anthropic's transient OAuth 500s.

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
