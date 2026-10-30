---
'@moxxy/cli': minor
'@moxxy/desktop': minor
'@moxxy/desktop-host': minor
'@moxxy/plugin-plugins-admin': patch
---

Moving to Supertonic goes through the full installer, because its model and native plugin ship only with the app: runner protocol v33 changes nothing on the wire and refuses a JS-only update. The launch after the one that copied Supertonic removes the three Piper voices. Supertonic's Open RAIL-M licence now ships with the plugin, and a desktop build without it fails.
