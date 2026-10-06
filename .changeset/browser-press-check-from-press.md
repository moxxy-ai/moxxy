---
'@moxxy/cli': patch
'@moxxy/desktop': patch
---

A click in the desktop's browser is no longer reported as "the tab is not on screen" when the press merely landed late. With the window behind another one, Chromium holds input for the next frame, so a press can take seconds to arrive; the check now waits from the moment the press was sent instead of from when it was armed.
