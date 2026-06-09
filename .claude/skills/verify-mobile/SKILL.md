---
name: verify-mobile
description: Verify the Expo mobile PoC and its WS pairing path without a physical device — use after touching apps/mobile or the shared client packages.
---

# Verify mobile

`apps/mobile` is an Expo PoC over the SHARED client layer — most logic (and
most risk) lives in the workspace packages, which have real tests:

```sh
pnpm --filter @moxxy/client-core test
pnpm --filter @moxxy/client-transport-ws test
pnpm --filter @moxxy/plugin-channel-mobile test
pnpm --filter @moxxy/mobile typecheck          # the app itself has typecheck only
```

Bundle proof (catches Metro/RN-incompatible imports — Node built-ins, DOM —
without a device):

```sh
cd apps/mobile && pnpm exec expo export --platform ios   # must complete with no resolution errors
```

Pairing flow (manual, simulator is enough):

```sh
node packages/cli/dist/bin.js mobile     # QR + ws://127.0.0.1:8765 + token (loopback default)
# real phone on LAN needs opt-in: MOXXY_MOBILE_HOST=0.0.0.0 moxxy mobile (QR then advertises the LAN IP)
cd apps/mobile && pnpm exec expo start   # Expo Go (SDK 54) → scan/connect → send a turn
```

Gotchas:
- The QR's `?t=` token is a PAIRING payload only — the app strips it and
  connects with the bearer subprotocol (A27). Don't re-enable query-token auth.
- `@moxxy/client-core` + `client-transport-ws` must stay DOM-free/Node-free
  (global WebSocket only) — that's what the export proof checks.
- Platform capabilities (mic/TTS/KV) are no-ops in the PoC by design
  (TECH_DEBT P3 #10) — don't "fix" that ad hoc; it needs a
  client-platform-expo package.
- More: `apps/mobile/README.md` (tunnel option included).
