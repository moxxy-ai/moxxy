---
'@moxxy/mobile-gateway-app': patch
---

Mobile app quality follow-ups:

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
