---
"@moxxy/plugin-provider-claude-code": patch
"@moxxy/plugin-plugins-admin": patch
"@moxxy/cli": patch
---

Trim the Claude Code subscription catalog to the four current models

The picker still offered `claude-sonnet-4-6`, `claude-opus-4-7` and `claude-opus-4-6`,
and pinned the default at `claude-sonnet-4-6`. The catalog is now `claude-fable-5`,
`claude-opus-5`, `claude-sonnet-5` and `claude-haiku-4-5`, with `claude-sonnet-5` as
the default (direct successor of the previous one). Haiku moves from the dated
`claude-haiku-4-5-20251001` id to the alias, and `claude-sonnet-5` gets its real
128k output ceiling instead of 64k.
