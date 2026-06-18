# @moxxy/client-transport-ws

## 0.1.14

### Patch Changes

- @moxxy/desktop-ipc-contract@0.7.5

## 0.1.13

### Patch Changes

- @moxxy/desktop-ipc-contract@0.7.4

## 0.1.12

### Patch Changes

- @moxxy/desktop-ipc-contract@0.7.3

## 0.1.11

### Patch Changes

- @moxxy/desktop-ipc-contract@0.7.2

## 0.1.10

### Patch Changes

- @moxxy/desktop-ipc-contract@0.7.1

## 0.1.9

### Patch Changes

- Updated dependencies [143264a]
  - @moxxy/desktop-ipc-contract@0.7.0

## 0.1.8

### Patch Changes

- Updated dependencies [c15a45a]
  - @moxxy/desktop-ipc-contract@0.6.1

## 0.1.7

### Patch Changes

- Updated dependencies [aacdf1d]
  - @moxxy/desktop-ipc-contract@0.6.0

## 0.1.6

### Patch Changes

- 5ab6c78: New `apps/mobile-poc`: a minimal Expo SDK 54 proof-of-concept app that pairs with `moxxy mobile` by scanning its QR code and chats with the agent through the shared `@moxxy/client-core` hooks over the WebSocket bridge (including the permission ask round-trip). Single screen, no router/styling stack — replaces the removed full mobile app with the smallest thing that proves the channel works end to end.

  `@moxxy/client-transport-ws` grows the client half of the pairing contract: `splitConnectUrl` strips the `?t=` pairing token off a scanned QR URL so it can be presented via the `Sec-WebSocket-Protocol` bearer entry instead of riding the live WS URL. The app consumes it at boot, and the desktop's QR ↔ app round-trip test now asserts against this shared function (it previously imported the removed `apps/mobile`'s parser, which broke `pnpm typecheck` on main).

## 0.1.5

### Patch Changes

- Updated dependencies [d0e0bd2]
  - @moxxy/desktop-ipc-contract@0.5.0

## 0.1.4

### Patch Changes

- Updated dependencies [5ab8629]
- Updated dependencies [2796066]
  - @moxxy/desktop-ipc-contract@0.4.0

## 0.1.3

### Patch Changes

- Updated dependencies [00d7425]
- Updated dependencies [cdc2cc5]
- Updated dependencies [e606178]
- Updated dependencies [4a8ec5d]
- Updated dependencies [6afc4c0]
  - @moxxy/desktop-ipc-contract@0.3.0

## 0.1.2

### Patch Changes

- @moxxy/desktop-ipc-contract@0.2.2

## 0.1.1

### Patch Changes

- 0326fb0: Harden the desktop/mobile WebSocket bridge (2026-06-09 audit, wave 5):

  - Reject browser-Origin upgrades unless allow-listed (`allowedOrigins`, default deny; native clients are unaffected).
  - Move the pairing token out of the URL: `Authorization: Bearer` or a `Sec-WebSocket-Protocol` bearer entry are the supported presentations; the legacy `?t=` query is opt-in (`allowQueryToken`, kept on only for the mobile channel's already-paired apps). The QR still carries the token, but the app strips it before connecting.
  - Token rotation end to end: `rotateChannelToken` (sdk, persisted with `createdAt` + 90-day staleness warning), `rotateAuthToken` on the live server (drops existing connections), `rotateWsBridgeToken` (desktop) and `MobileChannel.rotateToken`.
  - Backpressure + lifecycle: connection cap (default 8), slow-reader eviction (backlog above 4 MB past a 10s grace terminates the socket), and `close()` now terminates clients so desktop quit doesn't burn its shutdown timeout.
  - `WsRpcClient` no longer replays abandoned requests after reconnect (outbox cleared, queued requests rejected on disconnect) and stops reconnecting after a capped exponential backoff, surfacing a terminal `disconnected` status.
  - Hygiene: empty `MOXXY_WS_PORT` no longer binds an ephemeral port, the server reports the actually-bound port, and the desktop bridge reuses the shared sdk token persistence (userData location kept).
  - @moxxy/desktop-ipc-contract@0.2.1

## 0.1.0

### Minor Changes

- 85f9b91: Share the desktop client layer across platforms and expose the IPC over a WebSocket.

  The desktop renderer's hooks, state stores, chat model, and IPC client are now
  transport- and platform-agnostic so a future mobile app can reuse them:

  - **`@moxxy/client-core`** — the `use*` hooks + chat/connection/ask stores + chat
    model + the transport singleton + a platform-capability registry. DOM-free; the
    desktop renderer consumes it via thin `@/lib/*` shims (no behavior change).
  - **`@moxxy/client-platform-web`** — the Web implementations of those capabilities
    (mic capture/PCM16, Web Speech TTS, localStorage, window event bus).
  - **`@moxxy/design-tokens`** — framework-neutral tokens + a `:root` CSS generator.
  - **`@moxxy/client-transport-ws`** — a `MoxxyApi` over the global `WebSocket`
    (no Node deps), for remote clients.
  - **`@moxxy/ipc-server-ws`** — serves the same `IpcCommands`/`IpcEvents` contract
    over an authenticated WebSocket (loopback by default, bearer-token gated). The
    desktop's IPC handler registration is now transport-neutral (a `CommandBus`/
    `EventSink` seam + a shared `dispatch` core in `@moxxy/desktop-ipc-contract`), so the
    same handler bodies serve Electron IPC and the WebSocket; events fan out to both.
  - **`@moxxy/plugin-channel-mobile`** — a `mobile` channel that serves the bridge from
    the CLI backed by the runner's single session: `moxxy mobile` (and `moxxy serve --all`)
    expose it with no desktop needed. It can reach beyond the LAN via a cloudflared/ngrok
    tunnel (`channels.mobile.tunnel`) and prints a **QR code** (URL + token embedded) to
    pair. The desktop bridge stays opt-in via `MOXXY_WS_BRIDGE`.
  - **`@moxxy/sdk`** — adds `resolveChannelToken` + `bearerGuard`: the standard channel
    auth-token resolution (env → `channels.<name>.token` → a persisted secret) and a
    pre-connection bearer handler, so channels gate connections uniformly. The mobile
    bridge + WS server adopt them.

  A new `apps/mobile` Expo proof-of-concept drives the chat loop (and permission prompts)
  through the shared hooks over the WebSocket bridge — against either backend. First launch
  shows a QR scanner that pairs by scanning `moxxy mobile`'s code. Desktop behavior is
  unchanged.

### Patch Changes

- Updated dependencies [85f9b91]
  - @moxxy/desktop-ipc-contract@0.2.0
