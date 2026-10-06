---
'@moxxy/cli': patch
---

Computer Use: the native-helper transport, JSON-lines protocol and helper artifact check now live in one platform-neutral module shared by every backend. The transport speaks a configured protocol version and accepts registered helper events (cursor moves, preview frames) alongside the built-in control state; an unregistered event still fails closed. The artifact check also recognises macOS Mach-O executables (thin or universal). Windows behaviour is unchanged.
