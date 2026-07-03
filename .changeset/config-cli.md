---
'@moxxy/cli': minor
---

New `moxxy config show|get|set|path` command: read the merged config, print
a value at a dot-path, and set values (JSON-parsed, schema-validated,
comment-preserving — the same shared writer the `/settings` panel and the
`config_set` tool use) from the command line. `--scope user|project` picks
the target file for `set` (default: user).
