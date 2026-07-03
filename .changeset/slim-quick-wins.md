---
'@moxxy/cli': patch
'@moxxy/plugin-cli': patch
---

Stop shipping the 16 MB `bin.js.map` sourcemap in the published npm tarball
(unpacked size drops ~65%; local builds keep sourcemaps). Fix the TUI footer
hint that advertised `^B toggle skills` — Ctrl+B drops the first queued
message; the hint row now shows `^O tool detail` instead.
