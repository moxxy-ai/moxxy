---
'@moxxy/plugin-computer-control': patch
---

macOS: a click, drag or double-click in a background app no longer ends with a stray extra click. On macOS 27 the press that wakes up a browser before a background gesture landed in the app's own view after the gesture; it now lands far outside every window and screen.
