---
"@moxxy/desktop": patch
---

Self-heal the terminal "Update needed to continue" (protocol-incompatible) connection screen: when the spawned runner CLI is older than the app, the screen now offers a primary "Update CLI & reconnect" button that updates the bundled CLI in place (via `app.updateCli`) and re-runs the supervisor connect so the now-newer runner attaches cleanly — no hand-running npm. It shows an in-progress state while updating, surfaces failures with the exact manual `npm install --prefix "<userData>/cli" @moxxy/cli@latest` fallback, and when the app is the older side (a CLI update can't help) shows reinstall-the-app guidance instead of an update button.
