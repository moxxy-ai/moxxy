---
'@moxxy/sdk': minor
'@moxxy/desktop': minor
---

Declarative per-channel "connect step" in the desktop Channels panel. A channel now declares how its post-start "connect the other side" affordance is presented (`ChannelConnectStep` on `ChannelConfigDescriptor`: `kind: 'qr' | 'url' | 'instructions'`), and the desktop renders it uniformly — no per-channel UI code.

Telegram is the first consumer: on start it resolves its bot's `@username` (grammy `getMe`) and publishes a `https://t.me/<bot>` link through the existing `requestUrl` status spine, which the panel shows as a **QR + "Open in Telegram"** link. Slack's Request URL folds into the same mechanism (`kind: 'url'`). The QR renderer is shared between the Mobile gateway and the Channels panel.
