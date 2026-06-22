---
'@moxxy/client-transport-ws': patch
'@moxxy/plugin-channel-mobile': patch
---

Fix mobile (iOS) E2E pairing over the proxy relay. The encrypted channel framed
each ciphertext message as a **binary** WebSocket frame, but React Native's iOS
WebSocket silently drops binary frames — the phone's `ClientHello` never reached
the agent shim, so pairing failed with "transport closed during handshake"
(the relay, proxy, shim and handshake were all correct; a Node `ws` client
paired fine through the same production relay). The phone client and the agent
shim now exchange base64url **text** frames (delivered reliably across
RN/iOS/Android/browser) and still accept binary from a binary-capable peer.
