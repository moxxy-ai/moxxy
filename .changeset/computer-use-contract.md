---
'@moxxy/cli': patch
---

Computer Use: add the shared tool contract the new macOS and Windows backends will speak — input schemas for the Codex/Claude-style tools (app state, click, type, paste, keys, scroll, drag, mouse, hold key, batch, screenshot, zoom, access), an xdotool key-chord parser with system-combo and clipboard checks, the vision image budget and image-to-screen coordinate mapping, action outcomes with a next-step hint per error code, the indexed accessibility-tree text with diffs, and fencing of application text as untrusted data. Nothing is wired to the running tools yet.
