---
'@moxxy/cli': patch
---

The WhatsApp channel's `follow-redirects` moves to 1.16.2, past GHSA-mrwp-f3q8-3g9p (custom credentials could follow a redirect). Lint and the macOS installer build move their `minimatch` 9 and 10 to 11, past GHSA-g3hv-75wg-m249; the `minimatch` 3 and 5 that `electron-builder` pins have no fix they can load, run only while installers are built, and are listed in `SECURITY.md`.
