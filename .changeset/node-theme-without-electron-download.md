---
'@moxxy/desktop': patch
---

Saving a theme preference outside Electron no longer initializes its npm binary package, which could download Electron and time out the Windows test suite. The desktop still synchronizes its native theme when running inside Electron.
