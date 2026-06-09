---
name: debug-ws-bridge
description: Diagnose WebSocket-bridge connection failures (desktop MOXXY_WS_BRIDGE or moxxy mobile) — auth rejects, origin denials, port/token confusion.
---

# Debug the WS bridge

Two deployments of the same `@moxxy/ipc-server-ws` server:

| | Enable | Token (precedence) | Default port |
|---|---|---|---|
| Desktop | `MOXXY_WS_BRIDGE=1` (guarded dynamic import — off = not even loaded) | `MOXXY_WS_TOKEN` env → `<userData>/ws-token` file (generated once) | 8765 (`MOXXY_WS_PORT`; empty string = unset, NOT port 0) |
| `moxxy mobile` | the channel itself | `MOXXY_MOBILE_TOKEN` env → `channels.mobile.token` config → `~/.moxxy/mobile-token` | 8765 (`MOXXY_MOBILE_HOST` for LAN bind) |

Auth handshake (sdk channel-auth helpers):
- Token travels as `Authorization: Bearer <t>` **or** WS subprotocol
  `moxxy.bearer.<encoded>` (browser clients can't set headers).
- `?t=` query token is OFF by default (`MOXXY_WS_ALLOW_QUERY_TOKEN=1` re-enables;
  the mobile QR embeds `?t=` only as a pairing payload — the app strips it).
- Requests with a browser `Origin` header: default-DENY unless allow-listed
  (`allowedOrigins`); native clients send none. "Works from node, 403 from a
  web page" = this, working as intended.

Checklist:
```sh
lsof -nP -iTCP:8765 -sTCP:LISTEN        # is it bound, and by whom
cat "~/Library/Application Support/MoxxyAI Workspaces/ws-token"   # desktop token
cat ~/.moxxy/mobile-token                # mobile pairing secret
```
- Token mismatch after "rotation": env token wins at every resolve — rotate it
  at the source. Rotation (`rotateWsBridgeToken` / `rotateAuthToken`)
  terminates all live connections by design.
- Sudden disconnects under load: SlowReaderGuard kills sockets whose backlog
  stays >4MB past 10s (A29); connection cap is 8 at the handshake.
- Client gives up after ~10 backoff retries with terminal `disconnected`
  status (A28) — that's the WsRpcClient, not the server.
- Bound port is reported from `wss.address()` — trust the log line, not the
  config.
