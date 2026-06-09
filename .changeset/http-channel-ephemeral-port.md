---
"@moxxy/plugin-channel-http": patch
---

Fix flaky `EADDRINUSE` in the HTTP channel tests. `HttpChannel` now exposes the
actually-bound port via `boundPort` (the OS-assigned one when started with
`port: 0`), and the integration/attach tests bind an ephemeral port and read it
back instead of guessing a random port in 50000–59999 — which occasionally
collided when test files ran in parallel (seen on CI Node 22.x).
