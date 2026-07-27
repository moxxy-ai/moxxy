---
'@moxxy/cli': minor
'@moxxy/sdk': minor
---

Harden local state and the plugin install path.

Plugin installs now run npm with `--ignore-scripts`, so a package's (or a transitive dependency's) install hooks no longer execute with the user's privileges before its declared capabilities are ever read. `moxxy plugins install --allow-scripts` opts one install back in for native modules that compile or fetch a binding; the `install_plugin` model tool deliberately cannot reach that flag.

`~/.moxxy` is now created `0700`, and session transcripts, their sidecars, and `permissions.json` are written `0600`. Files left world-readable by an earlier version are tightened in place the next time they are used. A boot-time janitor removes atomic-write temp files abandoned by a killed process.

New in `@moxxy/sdk/server`: `ensurePrivateDir`, `ensurePrivateFile`, `pruneStaleTempFiles`, `PRIVATE_DIR_MODE`, `PRIVATE_FILE_MODE`.
