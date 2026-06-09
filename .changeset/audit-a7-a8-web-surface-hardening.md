---
'@moxxy/cli': patch
---

Stability hardening for the web surface and process recovery (audit A7/A8): port-conflict recovery (web channel EADDRINUSE + runner protocol-mismatch) now verifies the holder is a moxxy process before signalling it and otherwise falls back to an ephemeral port instead of killing whatever listens (e.g. ngrok's UI on 4040); inbound web-surface WS frames are zod-validated and dropped (rate-limited warn) instead of crashing the process; the CLI installs last-resort unhandledRejection/uncaughtException guards.
