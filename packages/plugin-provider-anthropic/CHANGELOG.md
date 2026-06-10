# @moxxy/plugin-provider-anthropic

## 0.1.7

### Patch Changes

- Updated dependencies [2796066]
  - @moxxy/sdk@0.10.0

## 0.1.6

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

## 0.1.5

### Patch Changes

- cf2f651: Provider-parity fixes from the 2026-06-09 audit (A36–A38):

  - **Codex (A36):** `req.maxTokens` now reaches the Responses API as `max_output_tokens`; `req.temperature` is documented-unsupported on the Codex backend (gpt-5 reasoning models reject sampling params) and dropped with a one-shot MOXXY_DEBUG note instead of silently; `reasoningEffort` is a live `CodexProviderConfig` option (was pinned to 'medium') and the CLI's codex credential resolver now passes `provider.config` through to the client instead of discarding it.
  - **Runtime openai-compat providers (A37):** registered vendors now report their own name + model catalog on the live client (usage stats / errors / context-window lookups no longer misattributed to 'openai'); vault/env key naming is unified behind `providerApiKeyName`/`storedProviderApiKeyName` in plugin-provider-admin — the CLI honors a stored `envVar` override and maps hyphens to underscores, matching the desktop; `provider_add` model descriptors can declare `supportsDocuments` so attachments stop degrading.
  - **`req.system` contract (A38):** hook-injected system text (e.g. plugin-memory's consolidation nudge) now actually reaches every provider — delivered in addition to system-role messages (anthropic: extra system block after the cache breakpoint; openai: inserted system message; codex: appended to `instructions`). The loop helpers no longer prefill `req.system` with the system prompt, which also removes a duplicated base prompt in codex `instructions`.

- Updated dependencies [cf2f651]
- Updated dependencies [cf2f651]
- Updated dependencies [cf2f651]
- Updated dependencies [cf2f651]
  - @moxxy/sdk@0.8.1

## 0.1.4

### Patch Changes

- Updated dependencies [0326fb0]
- Updated dependencies [2e4bc37]
- Updated dependencies [f3c798f]
- Updated dependencies [0326fb0]
  - @moxxy/sdk@0.8.0

## 0.1.3

### Patch Changes

- Updated dependencies [85f9b91]
  - @moxxy/sdk@0.7.0

## 0.1.2

### Patch Changes

- Updated dependencies [eac83e5]
  - @moxxy/sdk@0.6.0

## 0.1.1

### Patch Changes

- Updated dependencies [b928391]
  - @moxxy/sdk@0.5.1

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
  - @moxxy/sdk@0.5.0

## 0.0.5

### Patch Changes

- Updated dependencies [b014c3a]
  - @moxxy/sdk@0.4.0

## 0.0.4

### Patch Changes

- Updated dependencies [d362a6b]
  - @moxxy/sdk@0.3.0

## 0.0.3

### Patch Changes

- Updated dependencies [0afd61d]
  - @moxxy/sdk@0.2.0

## 0.0.2

### Patch Changes

- Updated dependencies [93d9a2d]
  - @moxxy/sdk@0.1.3

## 0.0.1

### Patch Changes

- Updated dependencies [c4352f9]
  - @moxxy/sdk@0.1.0
