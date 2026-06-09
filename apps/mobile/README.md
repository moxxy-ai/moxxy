# @moxxy/mobile — Expo proof-of-concept

A thin React Native app that drives the moxxy chat loop entirely through the
**shared** client packages — proof that the headless client layer runs unchanged
off Electron:

| Shared package | Role on mobile |
| --- | --- |
| `@moxxy/client-core` | the `use*` hooks + chat/connection stores + chat model (identical to desktop) |
| `@moxxy/client-transport-ws` | a `MoxxyApi` over the global `WebSocket` (no Node deps) |
| `@moxxy/design-tokens` | colors/radii consumed directly by `StyleSheet.create` |

Only the render layer (`src/App.tsx`, RN `View`/`Text`/`FlatList`) is
platform-specific. There is **no** desktop/DOM code here.

## Serve the bridge

The app connects to the same IPC contract served by either backend:

**A) `moxxy mobile` (no desktop needed).** The `mobile` channel runs a single
session over the WebSocket bridge and prints a **QR code** (+ URL + token) to
scan. It's also included in `moxxy serve --all`.

```sh
moxxy mobile                       # LAN — prints a QR for ws://<lan-ip>:8765
# reachable beyond the LAN via a tunnel (your choice), in moxxy.config.ts:
#   channels: { mobile: { tunnel: 'cloudflared' } }   // or 'ngrok'
# or: MOXXY_MOBILE_TUNNEL=cloudflared moxxy mobile     → prints a wss://… QR
```

**B) The desktop app** (mirrors your desktop workspaces): launch it with
`MOXXY_WS_BRIDGE=1` (token persisted at `<userData>/ws-token`, or `MOXXY_WS_TOKEN`).

## Run the app

1. From the repo root, install (pulls Expo + React Native) and start Metro:

   ```sh
   pnpm install
   pnpm --filter @moxxy/mobile start
   ```

2. On first launch the app opens a **QR scanner** — point it at the code from
   `moxxy mobile`. The token + URL are embedded, so it connects with no typing.
   (To skip scanning, bake in `EXPO_PUBLIC_MOXXY_WS_URL` / `EXPO_PUBLIC_MOXXY_WS_TOKEN`.)

3. Type a message — it runs a real turn on the host; `runner.event`s stream back
   through the shared `chatStore` and render in the list. Tool permissions prompt
   in-app (Allow/Deny).

## How it stays Metro-friendly

- The shared packages are consumed as their **built `dist`** (their `exports`
  map points there) — `pnpm build` must have run first. `metro.config.js`
  watches the workspace root and follows pnpm symlinks.
- `react` is a **peer** of `@moxxy/client-core` (range `^18.2.0`), so the single
  React instance is the one Expo/React Native provides — no duplicate-React
  "invalid hook call".
