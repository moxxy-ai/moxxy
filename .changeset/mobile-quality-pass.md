---
'@moxxy/mobile-gateway-app': patch
---

Mobile app quality pass (perf, security, consistency):

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
