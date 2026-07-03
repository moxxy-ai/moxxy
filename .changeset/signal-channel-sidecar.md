---
"@moxxy/cli": minor
"@moxxy/sdk": minor
---

Signal messenger channel via a signal-cli JSON-RPC sidecar (`@moxxy/plugin-channel-signal`).

- New installable `@moxxy/plugin-channel-signal`: moxxy joins your Signal
  account as a LINKED DEVICE (like Signal Desktop) through a `signal-cli`
  daemon the plugin fully owns — spawned on `start()` (JSON-RPC over a UNIX
  socket), health-checked (`version` round-trip), and killed on stop with a
  SIGTERM→SIGKILL grace. `isAvailable` gates on the binary with a pure PATH
  scan (no JVM spawn) and returns a `brew install signal-cli` hint instead of
  ever crashing discovery.
- Pairing is the linked-device flow: `moxxy channels signal pair` runs
  `signal-cli link -n moxxy`, renders the `sgnl://linkdevice…` URI as a
  terminal QR, and stores the account on completion; the desktop Channels
  panel drives the same window via channel-status (`requestUrl` carries the
  QR payload, `connected` flips when linked).
- Every session-reaching path is gated on a sender allow-list (E.164/uuid,
  vault key `signal_allowed_senders`); the owner's own "Note to Self" is
  allowed by default after linking. Sync echoes of the bot's own sends are
  dropped by sent-timestamp (loop protection), the owner's outbound
  conversations are never reacted to, and every envelope is zod-validated +
  size-capped before touching the session. Voice notes transcribe through the
  session's active Transcriber (20MB cap, install guidance when absent).
- Replies stream as buffered paragraph-aligned chunk sends plus a typing
  indicator instead of FramePump edits — a Signal edit re-delivers the whole
  body E2E to every device per frame, which burst-rate edits would turn into
  notification spam and rate-limit bait.
- Runs on its own dedicated, isolated runner (like Slack) — a linked device
  sees all the owner's messages. `SessionSource` gains `'signal'`.
