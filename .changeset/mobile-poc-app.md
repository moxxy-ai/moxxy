---
'@moxxy/client-transport-ws': patch
'@moxxy/mobile-poc': patch
---

New `apps/mobile-poc`: a minimal Expo SDK 54 proof-of-concept app that pairs with `moxxy mobile` by scanning its QR code and chats with the agent through the shared `@moxxy/client-core` hooks over the WebSocket bridge (including the permission ask round-trip). Single screen, no router/styling stack — replaces the removed full mobile app with the smallest thing that proves the channel works end to end.

`@moxxy/client-transport-ws` grows the client half of the pairing contract: `splitConnectUrl` strips the `?t=` pairing token off a scanned QR URL so it can be presented via the `Sec-WebSocket-Protocol` bearer entry instead of riding the live WS URL. The app consumes it at boot, and the desktop's QR ↔ app round-trip test now asserts against this shared function (it previously imported the removed `apps/mobile`'s parser, which broke `pnpm typecheck` on main).
