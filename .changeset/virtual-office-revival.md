---
'@moxxy/plugin-virtual-office': minor
'@moxxy/cli': patch
---

Revive the Virtual Office as a standalone, opt-in channel — `@moxxy/plugin-virtual-office`.

**`@moxxy/plugin-virtual-office` (new):** the office is its OWN channel
(`defineChannel`), not an extension of the generic HTTP channel and not a core
seam. `moxxy virtual-office` stands up the office's own HTTP + SSE server, which
serves the multi-agent surface: the office-agent runtime (per-agent EventLog /
sessionId / allowed-tools registry), the unified-timeline SSE stream (with the
`sensitive`-envelope drop so tokens/secrets never reach the wire), the graveyard,
and the agent CRUD/run/stop/reset/history routes. The channel is its own security
boundary — it bearer-auths every route with the shared `bearerTokenMatches` /
`resolveChannelToken` helpers (env `MOXXY_VIRTUAL_OFFICE_TOKEN` → config → a
generated, persisted secret), zod-validates request bodies, and size-caps the
agent-run/image path (10 MB per image, 4 images max) before parse. Pass
`channels.virtual-office.interactivePermissions: true` to route tool checks
through the out-of-band `POST /v1/permissions/{id}/decision` flow (the channel
installs the `HttpPermissionBroker` as its resolver). Opt-in: nothing runs unless
the channel is invoked.

**`@moxxy/cli` (patch):** register the office plugin as a builtin so
`moxxy virtual-office` is available; it stays inert until invoked.

No changes to `@moxxy/sdk`, `@moxxy/core`, or `@moxxy/plugin-channel-http` — the
office reuses only the generic channel-auth/body-read helpers that already exist
on `@moxxy/sdk`, so there is no extension contract in core or the HTTP channel.
