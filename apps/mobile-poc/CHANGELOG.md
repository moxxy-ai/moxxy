# @moxxy/mobile-poc

## 0.0.7

### Patch Changes

- Updated dependencies [e1fb6a6]
- Updated dependencies [e1fb6a6]
  - @moxxy/sdk@0.14.0
  - @moxxy/client-core@0.6.2
  - @moxxy/client-transport-ws@0.1.11

## 0.0.6

### Patch Changes

- Updated dependencies [89ad994]
  - @moxxy/sdk@0.13.0
  - @moxxy/client-core@0.6.1
  - @moxxy/client-transport-ws@0.1.10

## 0.0.5

### Patch Changes

- Updated dependencies [33e9640]
- Updated dependencies [143264a]
- Updated dependencies [7366a09]
- Updated dependencies [951f374]
  - @moxxy/sdk@0.12.0
  - @moxxy/client-core@0.6.0
  - @moxxy/client-transport-ws@0.1.9

## 0.0.4

### Patch Changes

- Updated dependencies [c15a45a]
  - @moxxy/client-core@0.5.1
  - @moxxy/client-transport-ws@0.1.8

## 0.0.3

### Patch Changes

- Updated dependencies [aacdf1d]
  - @moxxy/sdk@0.11.0
  - @moxxy/client-core@0.5.0
  - @moxxy/client-transport-ws@0.1.7

## 0.0.2

### Patch Changes

- Updated dependencies [0e1fb70]
  - @moxxy/client-core@0.4.0

## 0.0.1

### Patch Changes

- 5ab6c78: New `apps/mobile-poc`: a minimal Expo SDK 54 proof-of-concept app that pairs with `moxxy mobile` by scanning its QR code and chats with the agent through the shared `@moxxy/client-core` hooks over the WebSocket bridge (including the permission ask round-trip). Single screen, no router/styling stack — replaces the removed full mobile app with the smallest thing that proves the channel works end to end.

  `@moxxy/client-transport-ws` grows the client half of the pairing contract: `splitConnectUrl` strips the `?t=` pairing token off a scanned QR URL so it can be presented via the `Sec-WebSocket-Protocol` bearer entry instead of riding the live WS URL. The app consumes it at boot, and the desktop's QR ↔ app round-trip test now asserts against this shared function (it previously imported the removed `apps/mobile`'s parser, which broke `pnpm typecheck` on main).

- Updated dependencies [5ab6c78]
  - @moxxy/client-transport-ws@0.1.6
