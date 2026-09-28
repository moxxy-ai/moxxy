---
'@moxxy/desktop': patch
---

macOS: raise the minimum system version to 12.0 (the bundled Electron's real floor) and ship the x64 native seed packages (keyring, sharp) in the universal app so Intel Macs get them too.
