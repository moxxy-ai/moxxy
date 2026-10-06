---
'@moxxy/desktop': patch
---

The desktop's Terminal pane no longer stays on "Terminal unavailable: not connected to a runner" when it is shown while a new conversation's runner is still starting. It tried to open the terminal once and kept that first failure; it now opens it as soon as the runner is connected, and opens it again after the runner restarts.
