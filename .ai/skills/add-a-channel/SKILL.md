---
name: add-a-channel
description: Build a new Channel (a surface that drives a Session — TUI/Telegram/HTTP/WS-style) — use when adding a new way to talk to moxxy.
---

# Add a channel

Full workflow: **`.claude/agents/channel-author.md`**. Repo-specific rules:

- `defineChannel({ name, start, subcommands })`. Channels are the ONE plugin
  kind allowed to import `@moxxy/core` (`Session`, `runTurn`,
  `createDeferredPermissionResolver`).
- **Filter event subscribers by `turnId`** — the shared `session.log` fans out
  to every listener; concurrent turns cross-contaminate without it.
- **Auth/pairing**: use the SDK channel-auth helpers — `resolveChannelToken`
  ({ envVar, fileName, dir? } → env → config → generated secret persisted to
  `~/.moxxy/<fileName>`), `rotateChannelToken`, and the bearer handshake
  (Authorization header or `moxxy.bearer.<encoded>` WS subprotocol). Query
  tokens off by default (A27). Browser-origin requests: default-deny unless
  allow-listed.
- **Validate every inbound frame/body with zod** before it touches the session
  (A8); drop invalid/oversized input with a rate-limited warning.
- **EADDRINUSE**: never kill the port holder without verifying its `ps`
  command line carries a moxxy marker (A7); otherwise fall back to an
  ephemeral port and log both ports.
- **Permission prompts**: deny-by-default headless; interactive surfaces use
  `createDeferredPermissionResolver`. Gate EVERY session-reaching path behind
  pairing — Telegram's callback handlers once skipped it (A46).
- `subcommands` give `moxxy channels <name> pair|status|...` for free;
  `bin.ts` knows nothing about specific channels.
- `/new` must call `SessionLike.reset?.()` and surface failure — a
  mirror-only clear desyncs seq-contiguous ingest (A10).

Reference impls: `plugin-channel-http` (auth + allow-list),
`plugin-channel-mobile` (WS bridge + QR pairing), `plugin-telegram` (TOFU
pairing). Register in `builtins.ts`; gate + changeset.
