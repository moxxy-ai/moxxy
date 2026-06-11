---
'@moxxy/cli': patch
---

Fix the WS bridge rejecting real iOS devices at the upgrade handshake. iOS React Native (SocketRocket) sends an `Origin` header derived from the WS URL it dials (ws→http, wss→https) — it is not a browser-only signal — so the Origin default-deny dropped every iPhone pairing with `moxxy mobile` or the desktop gateway. The bridge server now supports `setAllowedOrigins` on the live listener (a tunnel URL is only assigned after start), and both the mobile channel and the desktop mobile gateway allow-list exactly the origins of the URLs they advertise: the tunnel origin, the LAN/loopback connect-URL origin, and the loopback spellings for simulators. Default-deny for everything else is unchanged.
