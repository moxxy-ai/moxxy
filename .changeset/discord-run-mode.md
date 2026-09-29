---
'@moxxy/cli': minor
'@moxxy/desktop': minor
---

Choose how the Discord bot runs from Channels → Discord → Run mode: Manual (Start/Stop in the panel), With the app (starts when the desktop opens), or Always (a launchd/systemd background service that stays online with the app closed). Switching away from Always stops and removes the service, so nothing keeps running or restarts at login; the panel never starts a second copy of a bot the service already runs. Adds `discord` to `moxxy service` and `moxxy service status <name> --json`.
