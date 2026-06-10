---
'@moxxy/desktop': minor
---

Workflow builder: the skill and tool name fields are now dropdowns of what the session actually has registered (with an explicit "(not installed)" marker for saved names that no longer exist, an empty-state message when there are no skills/tools, and a free-text fallback while no session is attached). Also fixes the macOS Dock "exec" ghost: the runner and other run-as-node children are spawned via the app's LSUIElement Helper binary, so they no longer register a second Dock icon.
