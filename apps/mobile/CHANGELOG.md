# @moxxy/mobile-gateway-app

## 0.1.1

### Patch Changes

- 648c966: Mobile app: pair through the self-hosted E2E proxy relay. The pairing flow now
  recovers the agent fingerprint from the QR (`?fp=`) and threads it into the
  transport (`makeWsApiHandle({ e2e: { pinnedFingerprint } })`), so a relay QR
  runs the encrypted handshake instead of failing as a plain `ws://` connection;
  LAN pairing is unchanged.

  Add EAS deployment for the Expo app: `eas.json` build/submit profiles, a dynamic
  `app.config.ts` that injects the Expo `owner` + EAS `projectId` from the
  environment (so the account identity is never committed), and a
  `Mobile EAS Build` GitHub Actions workflow driven by repo secrets
  (`EXPO_TOKEN`, `EXPO_OWNER`, `EAS_PROJECT_ID`).

  Remove the retired `apps/mobile-poc` proof-of-concept (superseded by
  `apps/mobile`).

- 648c966: Mobile app quality follow-ups:

  - Perf: throttle the live token stream (`useThrottledValue`, ~25fps) so the
    transcript rebuild + list reconciliation + auto-scroll run at a bounded rate
    instead of once per chunk; settle (empty) flushes immediately so the streaming
    row drops in lockstep with the committed message (no duplicate flash).
  - Security: scope cleartext to the LAN at the layer where it's actually
    enforceable — refuse a cleartext `ws://` pairing URL whose host isn't
    LAN/loopback/link-local/`.local` (a hostile QR can't point `ws://` at a public
    attacker and leak the bearer). Android's `usesCleartextTraffic` stays on (the
    OS can't scope cleartext to dynamic LAN IPs), but the app now gates it.
  - Security: mask the pairing code (the bearer token) shown in the manual
    ConnectionSettings panel.

- 648c966: Mobile app quality pass (perf, security, consistency):

  - Perf: the live streaming assistant row now renders as plain text and only
    parses markdown once the message settles — removing an O(n²) re-parse of the
    growing text on every chunk and the resulting pollution of the shared markdown
    block cache. Fix an untracked auto-clear timer in `useAttachments`.
  - Security: refuse a `wss://` (proxy-relay) pairing URL that lacks the E2E
    fingerprint (`?fp=`) instead of silently downgrading to a plaintext bearer;
    allow-list markdown link schemes (http/https/mailto) before `Linking.openURL`
    so an agent/relay-authored reply can't trigger out-of-app actions.
  - Consistency: remove the dead, never-wired token-in-URL transport stack
    (`useGatewaySocket`, `socketLifecycle`, `useGatewaySnapshot`, `pairingClient`,
    `PairingPanel`, `StreamingAssistant`, and the `applyGatewayFrame` reducer) and
    its tests; the live path runs through `@moxxy/client-core`.

- Updated dependencies [648c966]
  - @moxxy/sdk@0.16.1
  - @moxxy/chat-model@0.3.4
  - @moxxy/client-core@0.10.3
  - @moxxy/client-transport-ws@0.2.1
