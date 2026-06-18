# @moxxy/mobile-poc

## 0.0.17

### Patch Changes

- @moxxy/client-core@0.8.4
- @moxxy/client-transport-ws@0.1.20

## 0.0.16

### Patch Changes

- Updated dependencies [72d89f3]
  - @moxxy/client-core@0.8.3
  - @moxxy/client-transport-ws@0.1.19

## 0.0.15

### Patch Changes

- Updated dependencies [50a5b38]
- Updated dependencies [50a5b38]
- Updated dependencies [50a5b38]
  - @moxxy/sdk@0.14.5
  - @moxxy/client-core@0.8.2
  - @moxxy/client-transport-ws@0.1.18

## 0.0.14

### Patch Changes

- @moxxy/client-core@0.8.1
- @moxxy/client-transport-ws@0.1.17

## 0.0.13

### Patch Changes

- Updated dependencies [c058735]
  - @moxxy/client-core@0.8.0
  - @moxxy/client-transport-ws@0.1.16

## 0.0.12

### Patch Changes

- 897a1fc: Long-tail review fixes (quality sweep, t3 cluster):

  - plugin-oauth: thread the flow's abort signal into device-flow poll fetches (and the OpenAI token exchange) so a hung in-flight poll cancels, not just the inter-poll sleep; drop redundant clearTimeout calls in the callback server (settle() is the single cleanup chokepoint); document the credential-lock stale-takeover TOCTOU window.
  - plugin-vault: randomCode now draws width-appropriate entropy and rejection-samples — fixes the silent leading-digit cap for codes >= 10 digits and the modulo bias.
  - plugin-mcp: one malformed mcp.json entry no longer discards the whole server catalog (per-entry parse keeps valid rows); MCP resource results pass through inline text instead of a bare [resource]; createMcpPlugin connects servers in parallel (boot bounded at the slowest, not the sum).
  - plugin-scheduler: describeEntry shares the poller's next-fire baseline so the displayed next-fire agrees with when isDue fires; tickOnce counts due-and-attempted schedules (counts a fired-but-failed run).
  - workflows-builder: block-scalar parser strips indentation by the minimum body indent (no longer corrupts a literal block whose lines are shallower than the first).
  - runner: createUnixSocketServer.onConnection is single-handler (last-write-wins), consistent with Transport.onFrame/onClose.
  - mobile-poc: boot the env-URL transport in an effect (not a render-phase useState initializer); guard approval allow/deny against forwarding an empty optionId.

- Updated dependencies [897a1fc]
  - @moxxy/sdk@0.14.4
  - @moxxy/client-core@0.7.1
  - @moxxy/client-transport-ws@0.1.15

## 0.0.11

### Patch Changes

- Updated dependencies [27bfaf6]
  - @moxxy/client-core@0.7.0

## 0.0.10

### Patch Changes

- Updated dependencies [5f20dab]
  - @moxxy/sdk@0.14.3
  - @moxxy/client-core@0.6.5
  - @moxxy/client-transport-ws@0.1.14

## 0.0.9

### Patch Changes

- Updated dependencies [091ef41]
  - @moxxy/sdk@0.14.2
  - @moxxy/client-core@0.6.4
  - @moxxy/client-transport-ws@0.1.13

## 0.0.8

### Patch Changes

- Updated dependencies [640d036]
- Updated dependencies [640d036]
  - @moxxy/client-core@0.6.3
  - @moxxy/sdk@0.14.1
  - @moxxy/client-transport-ws@0.1.12

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
