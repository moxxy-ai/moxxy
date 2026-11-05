---
'@moxxy/desktop': patch
---

Computer Use works again on macOS and Linux after the desktop updates itself without a new installer. The `@moxxy/plugin-computer-control` package on npm carries only the Windows helper, so a copy the desktop updated from npm offered `computer_status` alone until the next installer. The desktop now adds the helpers its installer carries to such a copy, at every launch and right after an update, without touching a helper the copy already has.
