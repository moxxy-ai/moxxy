---
"@moxxy/desktop": patch
---

Fix desktop self-update never sticking ("downloads but stays on the old version").

The boot-probe required the renderer's `app.appBooted` IPC heartbeat to land within
15s to mark a hot-updated bundle healthy; in packaged builds that heartbeat doesn't
reliably land, so the probe poisoned **every** healthy update and reverted to the
floor (confirmed from on-disk state: `bad.json` had poisoned every staged version and
`confirmed.json` never existed). The probe now confirms a healthy render from the
**main process** by inspecting the renderer DOM — `index.html` ships a static
`#splash-fallback` inside `#root` that React replaces on mount, so its absence is a
renderer-cooperation-free health signal. The IPC heartbeat is kept only as a fast
path; a genuine white-screen (never renders) is still poisoned and reverted.
