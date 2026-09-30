---
'@moxxy/cli': patch
---

Offer the current Claude models: Claude Fable 5.1 (`claude-fable-5-1`), Opus 5.5 (`claude-opus-5-5`), Sonnet 5.5 (`claude-sonnet-5-5`) and Haiku 4.5 (`claude-haiku-4-5`), for both the Anthropic API key and the Claude Pro/Max sign-in. Fable 5.1, Opus 5.5 and Sonnet 5.5 each have a 1M context window and 128K max output; Haiku 4.5 has 200K and 64K. Sonnet 5.5 is the new default, and Opus 5.5 is what `moxxy init` suggests for Anthropic. The previous generation is no longer listed, but a config can still pin it.
