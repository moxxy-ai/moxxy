---
'@moxxy/cli': patch
'@moxxy/desktop': patch
---

Fix: the Telegram connect step in the desktop Channels panel could stay stuck on "Connecting…" and never show the QR. The dedicated channel runner could be wedged before it published its status file in three independent ways, now all closed:

- A desktop-spawned channel runner now opts out of the co-attached web surface (`MOXXY_NO_WEB_SURFACE`, mirroring `moxxy serve`). Without it a remote channel (Telegram) opened a proxy tunnel during startup — _before_ the status write — so a slow/unreachable relay blocked it indefinitely; it also raced the fixed web port (4040) with `serve` and other channel runners.
- The dedicated runner writes its status file _before_ the optional web-surface co-attach, so its readiness/connect value is published independently of that tunnel.
- The up-front `getMe` (which resolves the `t.me` link) is now bounded by a timeout, so a slow/unreachable Telegram can't wedge `start()` — the channel comes up (and pairing still works) even when the link can't be resolved.
