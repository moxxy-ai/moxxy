---
'@moxxy/cli': patch
'@moxxy/desktop': patch
'@moxxy/plugin-computer-control': patch
---

Prevent Windows Computer Use from terminating when an observed control contains more than 512 UTF-16 code units. Preserve bounded Unicode text through an owning Windows Runtime string and cover truncation with native and installed-fixture regression tests.
