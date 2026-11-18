---
'@moxxy/desktop': minor
'@moxxy/desktop-ipc-contract': minor
'@moxxy/runner': minor
'@moxxy/cli': minor
'@moxxy/sdk': minor
'@moxxy/core': minor
'@moxxy/config': minor
'@moxxy/plugin-provider-codex-agent': minor
'@moxxy/plugin-provider-claude-code': minor
'@moxxy/plugin-provider-anthropic': patch
'@moxxy/plugin-provider-openai': patch
---

Reasoning effort goes up to Max and Ultra. Each model now names the efforts it takes (`ModelDescriptor.reasoningEfforts`), read from the agent itself: Codex lists Max on every model and Ultra (Max that also hands parts of the task to subagents) on all but the Luna models, and Claude lists Max. The effort menu in the app and the default effort in Settings offer exactly those levels; a model that names none offers Low to Extra high, as before. Ultra reads "Ultra (delegates to subagents)", since the subagents use the plan too.

Picking a model that lacks the effort drops it to the deepest level the model has, at once and for good (Ultra, then Luna: Max, and Max stays when you go back to Sol), and a turn does the same on the runner, so every surface shows the effort turns run at. Claude has no Ultra and thinks at Max; the Anthropic Messages API still gets at most High, and the OpenAI API gets Max for Ultra. OpenCode stays at Low to Extra high for now, because it names a model's levels only inside a running session.

Runner protocol v35: `session.setReasoning` takes `max` and `ultra`, and a newer client never sends them to an older runner.
