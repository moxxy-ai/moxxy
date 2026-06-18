# @moxxy/plugin-provider-claude-code

## 0.1.11

### Patch Changes

- Updated dependencies [89ad994]
  - @moxxy/sdk@0.13.0
  - @moxxy/plugin-oauth@0.0.16
  - @moxxy/plugin-provider-anthropic@0.1.10

## 0.1.10

### Patch Changes

- Updated dependencies [33e9640]
- Updated dependencies [143264a]
- Updated dependencies [7366a09]
- Updated dependencies [951f374]
  - @moxxy/sdk@0.12.0
  - @moxxy/plugin-provider-anthropic@0.1.9
  - @moxxy/plugin-oauth@0.0.15

## 0.1.9

### Patch Changes

- Updated dependencies [aacdf1d]
  - @moxxy/sdk@0.11.0
  - @moxxy/plugin-oauth@0.0.14
  - @moxxy/plugin-provider-anthropic@0.1.8

## 0.1.8

### Patch Changes

- Updated dependencies [2796066]
  - @moxxy/sdk@0.10.0
  - @moxxy/plugin-oauth@0.0.13
  - @moxxy/plugin-provider-anthropic@0.1.7

## 0.1.7

### Patch Changes

- 1e4ed09: chore(debt): unify tunnel spawning, finish MoxxyError adoption, retire stale casts

  Round-3 tech-debt drawdown:

  - **Tunnel unification (P2 #4).** New `spawnCliTunnel` + `isCliTunnelAvailable` exports on
    `@moxxy/sdk` own the spawn → parse-URL → resolve/reject lifecycle and no-orphan child
    cleanup for CLI tunnels. cloudflared/ngrok (channel-web) are now thin configs over it,
    and the webhooks plugin consumes registered `TunnelProviderDef`s instead of its own
    `startTunnel` (same URLs parsed, same teardown/pid/stop surface). channel-web's
    `child-cleanup.ts` is removed (folded into the SDK helper).
  - **MoxxyError adoption (P2 #5).** User-facing throws migrated to typed `MoxxyError`:
    oauth_authorize missing deviceUrl/authUrl (`TOOL_ERROR`), vault placeholder missing entry
    (`CONFIG_INVALID`), vault_get not-found (`TOOL_ERROR`), unsupported vault file
    (`VAULT_CORRUPT`). Internal invariant throws stay plain `Error`.
  - **Casts / hardcoded values (P3 #8).** Removed the `as unknown` exec-allowlist cast in
    plugin-security (CapabilitySpec.commands is now typed), tightened the Anthropic provider's
    `requestBody`/`countTokens` casts to the SDK's real param types (narrow, commented casts
    only where the SDK literal-narrows `media_type`), and corrected stale hardcoded model
    context windows (opus-4-7 / sonnet-4-6 are 1M, not 800k/200k) + maxOutputTokens.
  - **RemoteSession seam casts (P1 #1).** Dropped the redundant `as unknown as SessionLike`
    and command-handler casts in `desktop-host` (RemoteSession implements ClientSession →
    SessionLike; CommandContext.session is `unknown`).

- Updated dependencies [1e4ed09]
- Updated dependencies [4a8ec5d]
- Updated dependencies [6afc4c0]
  - @moxxy/sdk@0.9.0
  - @moxxy/plugin-oauth@0.0.12
  - @moxxy/plugin-provider-anthropic@0.1.6

## 0.1.6

### Patch Changes

- Updated dependencies [cf2f651]
- Updated dependencies [cf2f651]
- Updated dependencies [cf2f651]
- Updated dependencies [cf2f651]
  - @moxxy/sdk@0.8.1
  - @moxxy/plugin-provider-anthropic@0.1.5
  - @moxxy/plugin-oauth@0.0.11

## 0.1.5

### Patch Changes

- 05d643a: Serialize OAuth refreshes of single-use rotating refresh tokens (claude-code, openai-codex) and stop the vault from clobbering other writers. Refresh+persist now runs under a per-credential lock (new `withCredentialLock` in plugin-oauth: in-process mutex + best-effort O_EXCL lockfile with stale takeover under `<moxxy home>/locks`), so concurrent consumers — a second stream, the whisper-stt transcriber, or another moxxy process — coalesce into ONE IdP call and adopt the winner's rotated tokens instead of burning them; an invalid_grant after a concurrent rotation re-reads the vault and retries once with the fresher refresh token before declaring re-auth needed (CodexProvider gains a `reloadTokens` hook for this). `VaultStore` no longer persists a whole-file in-memory snapshot (last-writer-wins): every read/mutation folds the on-disk file back in (mtime-gated, newer-`updatedAt`-wins per key) before the atomic rename, so two processes writing different keys both survive.
- Updated dependencies [0326fb0]
- Updated dependencies [2e4bc37]
- Updated dependencies [05d643a]
- Updated dependencies [f3c798f]
- Updated dependencies [0326fb0]
  - @moxxy/sdk@0.8.0
  - @moxxy/plugin-oauth@0.0.10
  - @moxxy/plugin-provider-anthropic@0.1.4

## 0.1.4

### Patch Changes

- Updated dependencies [85f9b91]
  - @moxxy/sdk@0.7.0
  - @moxxy/plugin-oauth@0.0.9
  - @moxxy/plugin-provider-anthropic@0.1.3

## 0.1.3

### Patch Changes

- Updated dependencies [eac83e5]
  - @moxxy/sdk@0.6.0
  - @moxxy/plugin-oauth@0.0.8
  - @moxxy/plugin-provider-anthropic@0.1.2

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
