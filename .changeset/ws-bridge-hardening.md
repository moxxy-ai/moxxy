---
'@moxxy/ipc-server-ws': patch
'@moxxy/client-transport-ws': patch
'@moxxy/plugin-channel-mobile': patch
'@moxxy/sdk': patch
'@moxxy/desktop': patch
---

Harden the desktop/mobile WebSocket bridge (2026-06-09 audit, wave 5):

- Reject browser-Origin upgrades unless allow-listed (`allowedOrigins`, default deny; native clients are unaffected).
- Move the pairing token out of the URL: `Authorization: Bearer` or a `Sec-WebSocket-Protocol` bearer entry are the supported presentations; the legacy `?t=` query is opt-in (`allowQueryToken`, kept on only for the mobile channel's already-paired apps). The QR still carries the token, but the app strips it before connecting.
- Token rotation end to end: `rotateChannelToken` (sdk, persisted with `createdAt` + 90-day staleness warning), `rotateAuthToken` on the live server (drops existing connections), `rotateWsBridgeToken` (desktop) and `MobileChannel.rotateToken`.
- Backpressure + lifecycle: connection cap (default 8), slow-reader eviction (backlog above 4 MB past a 10s grace terminates the socket), and `close()` now terminates clients so desktop quit doesn't burn its shutdown timeout.
- `WsRpcClient` no longer replays abandoned requests after reconnect (outbox cleared, queued requests rejected on disconnect) and stops reconnecting after a capped exponential backoff, surfacing a terminal `disconnected` status.
- Hygiene: empty `MOXXY_WS_PORT` no longer binds an ephemeral port, the server reports the actually-bound port, and the desktop bridge reuses the shared sdk token persistence (userData location kept).
