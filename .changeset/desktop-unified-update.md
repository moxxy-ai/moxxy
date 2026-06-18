---
"@moxxy/desktop": patch
"@moxxy/client-core": patch
---

Desktop: collapse the three separate update controls (Update CLI, Update
dashboard, Update app) into ONE "Update" button. A single action now brings both
the runner (`@moxxy/cli`, restarts live) and the desktop app (hot-update bundle,
or full installer when a hot-update can't deliver) to the latest version
together. The settings panel shows both versions; the runner update is non-fatal
(the bundled CLI keeps working if npm isn't available). No update-engine or IPC
changes — the existing primitives are just composed behind one `runUpdateAll`.
