---
'@moxxy/desktop': patch
'@moxxy/desktop-host': patch
'@moxxy/desktop-ipc-contract': patch
'@moxxy/client-core': patch
---

"Requires full update" releases now install themselves. New `app.updateShell` IPC drives electron-updater against a generic feed pinned at the exact `desktop-v<version>` release assets (GitHub latest/atom discovery can't parse `desktop-v*` tags), streaming download progress over `app.update.progress` and quit-and-installing on completion; the banner/Settings CTA becomes "Update app" with the release page kept as a fallback once an automatic attempt fails. macOS builds add a `zip` target so Squirrel.Mac can apply them, and desktop releases are no longer marked "Latest" on GitHub (`make_latest: false`).
