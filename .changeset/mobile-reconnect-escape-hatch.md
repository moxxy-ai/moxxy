---
"@moxxy/workspaces-app": patch
---

Mobile: don't strand a paired device on "Connecting to your Mac…" when the
stored gateway is stale.

A paired device that can no longer reach its Mac (desktop offline, tunnel URL
rotated, or token revoked) used to spin on the connecting splash forever with no
way out — the only path back to pairing required the stored token to be cleared,
which nothing surfaced. The reconnect screen now keeps spinning briefly, then
reveals the bridge error and a **Change configuration** button (it disconnects
and returns to the pairing screen) — and surfaces that escape hatch immediately
if the bridge reports an error.
