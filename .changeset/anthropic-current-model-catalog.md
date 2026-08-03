---
"@moxxy/plugin-provider-anthropic": patch
"@moxxy/config": patch
"@moxxy/cli": patch
---

Trim the Anthropic API catalog to the four current Claude models

The picker still offered `claude-opus-4-7`, `claude-opus-4-6` and `claude-sonnet-4-6`,
listed Haiku under its dated id, and pinned the default at `claude-sonnet-4-6`. The
catalog is now `claude-fable-5`, `claude-opus-5`, `claude-sonnet-5` and
`claude-haiku-4-5`, which matches the Claude Code catalog and the ids Anthropic
documents today. `claude-sonnet-5` becomes the default (direct successor of the
previous one) and gets its real 128k output ceiling instead of 64k; key validation
and the `config_init` template move to current ids as well. Older generations are
still served by the API and can still be pinned in config, they are just no longer
offered in the picker.
