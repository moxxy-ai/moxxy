---
'@moxxy/cli': patch
'@moxxy/desktop': patch
'@moxxy/desktop-host': patch
'@moxxy/desktop-ipc-contract': patch
'@moxxy/client-core': patch
---

The mobile app is gone, and with it everything that existed only to pair a phone. The desktop no longer has a Mobile place in its menu or search, and no longer starts a WebSocket bridge (the `MOXXY_WS_*` variables do nothing now). The CLI no longer has `moxxy mobile`, the `MOXXY_MOBILE_*` variables or the enterprise profile's `channels.mobile` lock. The `@moxxy/plugin-channel-mobile`, `@moxxy/ipc-server-ws` and `@moxxy/client-transport-ws` packages, the `mobileGateway.*` desktop IPC commands and event, the `mobileGatewayEnabled` preference and `useMobileGateway` were removed. Conversations started from the phone still show in the desktop history, and a preferences file that still names the gateway still loads.
