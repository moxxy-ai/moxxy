---
"@moxxy/sdk": minor
"@moxxy/plugin-channel-web": patch
"@moxxy/plugin-webhooks": patch
"@moxxy/plugin-oauth": patch
"@moxxy/plugin-vault": patch
"@moxxy/plugin-security": patch
"@moxxy/plugin-provider-anthropic": patch
"@moxxy/plugin-provider-claude-code": patch
"@moxxy/desktop-host": patch
---

chore(debt): unify tunnel spawning, finish MoxxyError adoption, retire stale casts

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
