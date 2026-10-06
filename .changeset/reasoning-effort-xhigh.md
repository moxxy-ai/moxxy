---
'@moxxy/cli': minor
'@moxxy/sdk': minor
'@moxxy/desktop': patch
---

Reasoning effort has a new level, `xhigh`, in `context.reasoning.effort`, in the desktop's provider settings and in the SDK's `ReasoningEffort` type. Anthropic models receive it as `high`. `context.reasoning` from the config is now applied when a session starts; before, it only took effect after the config was edited while Moxxy was running, so one-shot runs always used the provider's default effort.
