# @moxxy/mobile-poc

The smallest Expo app (SDK 54) that proves the mobile channel end to end: scan
the QR `moxxy mobile` prints, connect to the runner's WebSocket bridge, and
chat with the agent — including the permission/approval ask round-trip.

It is a single screen on purpose. No router, no styling stack, no
voice/attachments: the connection + chat path runs entirely through the shared
`@moxxy/client-core` hooks over `@moxxy/client-transport-ws` — the same
headless client layer the desktop renderer uses.

## Run it

1. Start the channel on this machine (from the repo root, after `pnpm build`):

   ```sh
   moxxy mobile
   ```

   For a real phone the bridge must be reachable beyond loopback. Prefer a
   tunnel — the QR then carries a `wss://` URL, so the whole connection
   (token handshake included) is TLS-encrypted with a publicly trusted cert:

   ```sh
   MOXXY_MOBILE_TUNNEL=cloudflared moxxy mobile
   ```

   Alternatively bind on the LAN (`MOXXY_MOBILE_HOST=0.0.0.0 moxxy mobile`) —
   but that path is plain `ws://`: a phone can't trust a self-signed cert for
   a private IP (no CA issues one, and RN/Expo Go has no cert-pinning escape
   hatch), so LAN traffic — the bearer handshake included — rides cleartext.
   Fine on a trusted home network, not elsewhere. Either way the terminal
   prints a QR with the connect URL + pairing token.

2. Start the app and open it in Expo Go (or a dev build):

   ```sh
   pnpm --filter @moxxy/mobile-poc start
   ```

3. Scan the QR from step 1 inside the app. You're chatting with the runner's
   session; tool permission prompts surface as Allow/Deny cards.

### Simulator shortcut (no camera)

Bake the connect URL in via env and the app skips the scanner — loopback works
because the simulator shares the host's network:

```sh
EXPO_PUBLIC_MOXXY_WS_URL='ws://127.0.0.1:8765/?t=<token>' pnpm --filter @moxxy/mobile-poc start
```

(`?t=` is split off and presented as the WebSocket bearer subprotocol, exactly
like a scanned QR; `EXPO_PUBLIC_MOXXY_WS_TOKEN` works too if you prefer the
token separate.)

## Notes

- The token never rides the live WS URL: `src/boot.ts` strips `?t=` from the
  scanned pairing URL and authenticates via the `Sec-WebSocket-Protocol`
  bearer entry (`moxxy.bearer.<token>`).
- `metro.config.js` is monorepo-aware: it watches the repo root, resolves the
  hoisted pnpm `node_modules`, and pins react/react-native to the app's copy so
  workspace packages' own React (kept for their vitest suites) never bundles.
- The shared packages are consumed as their built `dist`, so run `pnpm build`
  at the repo root before `expo start` (and after editing any `@moxxy/*`
  package).
