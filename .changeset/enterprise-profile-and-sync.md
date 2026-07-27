---
'@moxxy/cli': minor
---

Add `moxxy profile` and `moxxy sync`: install a baseline, then keep a fleet on it.

`moxxy profile enterprise` prints a system-scope config with the security controls already set and locked: isolation enforced through a real process boundary, undeclared third-party tools denied, executable project configs refused, audit on. It only prints, and its site-specific entries (proxy URL, audit sink) ship commented out. The file belongs in a root-owned location and a profile that guessed a proxy would be wrong everywhere, so the operator reviews and places it.

`moxxy sync` reconciles installed plugins against the merged `plugins.packages` manifest, which makes that map the reproducible, reviewable description of what a workstation runs. `--check` reports drift and exits 1 without changing anything, so it gates a provisioning pipeline. Sync installs what is missing and reports what is extra; it never removes a package a user chose to install.

Extras are identified from the plugin host's own bundled-versus-discovered flag rather than from package names, so the bundled kernel is never reported as drift.
