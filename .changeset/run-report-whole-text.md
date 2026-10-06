---
'@moxxy/cli': patch
'@moxxy/desktop': patch
---

A `browser_run` report quotes what a step typed whole (up to 200 characters, a longer text marked as cut with its length) instead of silently cutting it at 60 — an address cut before its port read as the port not taken, and the agent typed it again and again. A field that does not hold what was typed is quoted the same way.
