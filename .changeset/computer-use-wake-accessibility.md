---
'@moxxy/cli': patch
---

Computer Use on macOS no longer gives up on a browser page that a background window keeps from accessibility. The helper switches on the app's full accessibility tree when it first looks at it (and switches it back off when it leaves), and a page that still does not show gets its window brought forward once before the model is told the page is not readable. Safari's start page is read in under 2 s instead of 8.
