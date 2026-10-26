---
'@moxxy/desktop': patch
---

The desktop installer carries the Codex and OpenCode agent connections beside Claude, so Settings → Providers → Coding agents lists all three after installing. Neither is on npm, so before this they could not be added at all; the resource check now fails a build without them.
