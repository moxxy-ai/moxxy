---
'@moxxy/cli': minor
---

Add a system config scope, lockable settings, and consent for executable project configs.

There was no layer above the user's own config, so an organisation could not state "security.enabled is true and you may not turn it off". A system scope (`/etc/moxxy/config.yaml`, `%PROGRAMDATA%\moxxy\config.yaml`, or `$MOXXY_SYSTEM_CONFIG`) now loads first, and its `locked: [...]` dot-paths are stripped from the user, project, and explicit layers before merging. It is YAML only: an executable file there would run as whoever starts moxxy.

`moxxy.config.ts` is code, executed with your full privileges before the permission engine, the vault, or any isolator exists, and the project search walks upward, so entering a cloned repository ran its config silently. Moxxy now asks first and records approval against the file's content, so an edit asks again. Non-interactive runs skip an unapproved file rather than executing unreviewed code; `moxxy config trust` pre-approves one for daemons and container images, and a system config can set `config.allowExecutable: false` to forbid them outright.

New commands: `moxxy config trust [file]`, `moxxy config trust --list`, `moxxy config untrust <file>`.

**Behaviour change:** a project `moxxy.config.ts` that used to load silently now requires one-time approval. YAML configs are unaffected.
