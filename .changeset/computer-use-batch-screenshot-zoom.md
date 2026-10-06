---
'@moxxy/cli': patch
---

Computer Use on macOS runs batches, full-screen screenshots and zoom in its native helper. A batch runs several steps on one app, each through its own safety checks, stops at the first step that does not go through (or when the user pauses) and returns the app's state once at the end. The full-screen screenshot shows only granted apps on the main display, without the menu bar, everything else black; zoom looks closer at a region of the latest app or full-screen screenshot at native resolution and refuses a region outside it or a window that moved since.
