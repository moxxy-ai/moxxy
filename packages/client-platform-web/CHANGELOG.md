# @moxxy/client-platform-web

## 0.1.31

### Patch Changes

- Updated dependencies [0d6df6e]
  - @moxxy/sdk@0.17.0
  - @moxxy/client-core@0.10.4

## 0.1.30

### Patch Changes

- Updated dependencies [648c966]
  - @moxxy/sdk@0.16.1
  - @moxxy/client-core@0.10.3

## 0.1.29

### Patch Changes

- Updated dependencies [b19d401]
  - @moxxy/sdk@0.16.0
  - @moxxy/client-core@0.10.2

## 0.1.28

### Patch Changes

- Updated dependencies [92fecb8]
  - @moxxy/sdk@0.15.2
  - @moxxy/client-core@0.10.1

## 0.1.27

### Patch Changes

- Updated dependencies [e762d40]
- Updated dependencies [e762d40]
  - @moxxy/client-core@0.10.0
  - @moxxy/sdk@0.15.1

## 0.1.26

### Patch Changes

- Updated dependencies [668bd96]
  - @moxxy/client-core@0.9.0

## 0.1.25

### Patch Changes

- @moxxy/client-core@0.8.8

## 0.1.24

### Patch Changes

- @moxxy/client-core@0.8.7

## 0.1.23

### Patch Changes

- Updated dependencies [389c2c8]
  - @moxxy/client-core@0.8.6

## 0.1.22

### Patch Changes

- Updated dependencies [cbf115b]
  - @moxxy/sdk@0.15.0
  - @moxxy/client-core@0.8.5

## 0.1.21

### Patch Changes

- @moxxy/client-core@0.8.4

## 0.1.20

### Patch Changes

- Updated dependencies [72d89f3]
  - @moxxy/client-core@0.8.3

## 0.1.19

### Patch Changes

- Updated dependencies [50a5b38]
- Updated dependencies [50a5b38]
- Updated dependencies [50a5b38]
  - @moxxy/sdk@0.14.5
  - @moxxy/client-core@0.8.2

## 0.1.18

### Patch Changes

- @moxxy/client-core@0.8.1

## 0.1.17

### Patch Changes

- Updated dependencies [c058735]
  - @moxxy/client-core@0.8.0

## 0.1.16

### Patch Changes

- @moxxy/client-core@0.7.1

## 0.1.15

### Patch Changes

- Updated dependencies [27bfaf6]
  - @moxxy/client-core@0.7.0

## 0.1.14

### Patch Changes

- @moxxy/client-core@0.6.5

## 0.1.13

### Patch Changes

- @moxxy/client-core@0.6.4

## 0.1.12

### Patch Changes

- Updated dependencies [640d036]
  - @moxxy/client-core@0.6.3

## 0.1.11

### Patch Changes

- @moxxy/client-core@0.6.2

## 0.1.10

### Patch Changes

- @moxxy/client-core@0.6.1

## 0.1.9

### Patch Changes

- Updated dependencies [7366a09]
- Updated dependencies [951f374]
  - @moxxy/client-core@0.6.0

## 0.1.8

### Patch Changes

- Updated dependencies [c15a45a]
  - @moxxy/client-core@0.5.1

## 0.1.7

### Patch Changes

- Updated dependencies [aacdf1d]
  - @moxxy/client-core@0.5.0

## 0.1.6

### Patch Changes

- Updated dependencies [0e1fb70]
  - @moxxy/client-core@0.4.0

## 0.1.5

### Patch Changes

- Updated dependencies [d0e0bd2]
  - @moxxy/client-core@0.3.0

## 0.1.4

### Patch Changes

- Updated dependencies [2796066]
  - @moxxy/client-core@0.2.0

## 0.1.3

### Patch Changes

- Updated dependencies [a1e5df1]
- Updated dependencies [4a8ec5d]
  - @moxxy/client-core@0.1.3

## 0.1.2

### Patch Changes

- @moxxy/client-core@0.1.2

## 0.1.1

### Patch Changes

- @moxxy/client-core@0.1.1

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
  - @moxxy/client-core@0.1.0
