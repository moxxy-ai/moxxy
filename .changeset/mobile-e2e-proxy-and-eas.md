---
'@moxxy/mobile-gateway-app': patch
'@moxxy/plugin-channel-mobile': patch
---

Mobile app: pair through the self-hosted E2E proxy relay. The pairing flow now
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
