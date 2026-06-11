---
'@moxxy/plugin-channel-mobile': patch
'@moxxy/mobile': patch
---

Fix the phone never connecting to the desktop-started mobile gateway on the same network. Two defects: (1) the advertised QR host picked the first non-internal IPv4, so a VPN/Docker/link-local interface could be advertised instead of the reachable LAN IP — `lanHost` now ranks candidates (RFC1918 on physical NICs first, skipping utun/vmnet/bridge/awdl-style interfaces unless nothing else exists); (2) the built mobile app was missing iOS's `NSLocalNetworkUsageDescription` (iOS 14+ silently denies LAN dials without it) and Android's cleartext-`ws://` allowance — both added to app.json (requires a new native build; OTA updates do not deliver Info.plist/manifest changes). Expo Go masked both, which is why dev pairing worked.
