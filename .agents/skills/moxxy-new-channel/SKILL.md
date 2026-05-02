---
name: moxxy-new-channel
description: Use when the user wants to add a new chat platform transport (Slack, Matrix, IRC, email, SMS, etc.) to crates/moxxy-channel. Covers the ChannelTransport trait impl, bridge wiring, pairing, and optional CLI wizard.
---

# Add a New Moxxy Channel Transport

A channel transport bridges an external chat platform (Telegram, Discord, WhatsApp today) to the agent bus. Adding one means implementing the `ChannelTransport` trait, wiring it into the bridge, and usually adding a CLI wizard for configuration.

## How to invoke

Delegate the Rust side to the `moxxy-channel-author` agent:

```
Agent({
  subagent_type: "moxxy-channel-author",
  description: "Scaffold <platform> channel transport",
  prompt: "Add a new ChannelTransport for <platform>.

Auth model: <bot token | OAuth | incoming webhook>.
Ingest pattern: <long-poll | websocket gateway | webhook push>.
Platform capabilities: slash commands <yes/no>, typing indicator <yes/no>, audio messages <yes/no>, rich formatting <yes/no>.

Follow the existing transport conventions (read `telegram.rs` + `discord.rs` first). Use tokio::select! for cancellation, map inbound to IncomingMessage, handle all MessageContent variants in format_content only if plain text is lossy. Add inline tests. Run `cargo test -p moxxy-channel`."
})
```

## Before delegating — gather from the user

1. **Platform** — e.g. Slack, Matrix, IRC, email, Signal.
2. **Auth model** — bot token? OAuth? webhook URL? This determines whether we need a new vault secret type.
3. **Ingest pattern** — polling, persistent websocket, or HTTP webhook. Webhook-based channels need a gateway route for ingress; that's a separate change.
4. **Capabilities** — slash commands, typing, audio, rich text. Unsupported capabilities become no-op overrides.
5. **Existing SDK** — is there a Rust crate for this platform, or do we hand-roll HTTP? Check if its async runtime is tokio-compatible before committing.

## Cross-crate work that may follow

Call these out to the user *before* delegating, so they're not surprised:

- **Webhook ingress** — if the platform pushes rather than lets us poll, the gateway needs a new `POST /v1/channels/<platform>/webhook` route. That's outside `moxxy-channel-author`'s scope — hand off separately.
- **CLI wizard** — `moxxy channel add <platform>` needs a case in `apps/moxxy-cli/src/commands/channel.js`. Route to `moxxy-cli-author`.
- **Vault secret type** — if the auth flow needs a new secret shape, mention it and confirm with the user before `moxxy-channel-author` hardcodes the grant key.
- **Schema** — `ChannelRow` already carries a generic `config: String`. Prefer serializing platform config there over adding new columns; only route to `moxxy-storage-author` if the existing shape is genuinely inadequate.

## After the agent returns

1. Confirm the new `.rs` file exists under `crates/moxxy-channel/src/` and is exposed in `lib.rs`.
2. Confirm the bridge registers the transport (grep for how Telegram/Discord register — usually in `bridge.rs` or a dedicated init function).
3. Offer to wire the CLI wizard next via `moxxy-cli-author` if the user wants end-to-end `moxxy channel add <platform>` UX.
4. Run `moxxy-qa` scoped to `moxxy-channel` before committing.

## Constraints

- No credentials in code or tests. Ever. Use the vault grant pattern.
- The transport is untrusted input — every parsed message must go through the bridge's redaction layer before events are emitted.
