---
'@moxxy/cli': minor
'@moxxy/desktop': minor
---

Computer Use works on Linux in X11 sessions. A native helper reads apps through the accessibility bus (AT-SPI) and operates them with the same 12 tools as on macOS and Windows: controls are pressed and text is entered in the background, everything else goes through real input with the pointer given back, Escape stops the turn, and the desktop chat shows a live view of the window. In a Wayland session `computer_status` says that Computer Use is not ready and why. The Linux desktop installer ships the helper.
