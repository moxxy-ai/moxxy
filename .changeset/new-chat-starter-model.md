---
'@moxxy/sdk': minor
'@moxxy/core': patch
'@moxxy/cli': patch
'@moxxy/plugin-provider-claude-code': patch
'@moxxy/plugin-provider-codex-agent': patch
'@moxxy/plugin-provider-openai-codex': patch
'@moxxy/plugin-memory': patch
'@moxxy/reflector-default': patch
'@moxxy/desktop': patch
---

A new conversation no longer starts on the provider's biggest model when no default model is chosen. It starts on the provider's light starter model instead: Haiku 5.5 for Claude, GPT-6 Luna for Codex (both the agent connection and the ChatGPT sign-in). A default model chosen in Settings → Default model still comes first, and a conversation keeps the model it last ran on. Settings → Default model, the chat's effort and fast controls, a bot's "Default" model and the terminal's header now show the model that really runs, not the first one listed. The helper calls Moxxy makes by itself, outside the conversation, run on the starter model too instead of the biggest one: merging memories (`memory_consolidate`), drafting a workflow (`workflow_create`, unless the host sets a draft model) and the post-turn reflection.

The SDK adds `LLMProvider.starterModel`, `ProviderDef.starterModel`, `ProviderInfo.starterModel` and `startingModel()`. The runner protocol goes to v30 (`ProviderInfo.starterModel`, additive); an older runner leaves it out and surfaces fall back to the first listed model.
