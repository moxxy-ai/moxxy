---
'@moxxy/plugin-provider-anthropic': minor
'@moxxy/plugin-provider-claude-code': minor
'@moxxy/plugin-plugins-admin': patch
'@moxxy/sdk': patch
---

Replace `claude-opus-4-8` with `claude-opus-5` in the Claude catalogs.

Opus 4.8 is retired, so offering it meant a picker entry that cannot serve a request. `claude-opus-5` takes its place in both the Anthropic API catalog and the Claude Code subscription catalog, and becomes the Anthropic plugin's recommended `defaultModel`. `claude-fable-5` was already listed in both and is unchanged.

The new row copies the opus line's shape (1M context, 128k output, tools, images, documents, adaptive thinking, hosted web search) rather than being verified against the Models API, because the catalog is still hardcoded (TECH_DEBT P3 #8).

Removing 4.8 surfaced that the Claude Code catalog is enforced rather than advisory: a test passing a model outside it never reached the CLI at all. Tests that enumerate real catalog models were updated with it. One deliberately keeps `claude-opus-4-8` as its example of an unlisted id, which is now more accurate than before.
