---
"@moxxy/plugin-channel-mobile": patch
---

`moxxy mobile` no longer prints an unconnectable QR in the default config. The server binds loopback by default (deliberate security posture, unchanged) but the QR advertised the machine's LAN IP — an address nothing was listening on, so a real phone got connection refused. The connect URL now advertises exactly what is reachable: the loopback default prints `ws://127.0.0.1:<port>` (works for simulators on the same machine) plus a hint that a real device needs the explicit LAN opt-in or a tunnel; a wildcard bind (`0.0.0.0`/`::`) advertises the LAN IP; an explicit bind host is advertised verbatim; the tunnel path is unchanged. Also adds `MOXXY_MOBILE_HOST` (env → `channels.mobile.bindHost` config → loopback default, matching the channel's token/tunnel convention) and updates `apps/mobile/README.md` to document simulator-via-loopback vs phone-via-opt-in/tunnel.
