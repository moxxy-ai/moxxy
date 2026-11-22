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
'@moxxy/plugin-cli': patch
'@moxxy/plugin-provider-openai': minor
---

Reasoning effort goes up to Max and Ultra. Each model now names the efforts it takes (`ModelDescriptor.reasoningEfforts`), read from the agent itself: Codex lists Max on every model and Ultra (Max that also hands parts of the task to subagents) on all but the Luna models, and Claude lists Max. The effort menu in the app and the default effort in Settings offer exactly those levels; a model that names none offers Low to Extra high, as before. Ultra reads "Ultra (delegates to subagents)", since the subagents use the plan too.

Picking a model that lacks the effort drops it to the deepest level the model has, at once and for good (Ultra, then Luna: Max, and Max stays when you go back to Sol), and a turn does the same on the runner, so every surface shows the effort turns run at. Claude has no Ultra and thinks at Max; the Anthropic Messages API still gets at most High. The OpenAI API models offer up to Max, which the API takes on every listed model; it has no Ultra, so a turn at Ultra asks it for Max. The OpenAI API catalog also gains GPT-6.2 Sol, GPT-6.2 Astra, GPT-6.1 Terra and GPT-6.1 Sol, so it lists the same ten models as the API and Codex. OpenCode stays at Low to Extra high for now, because it names a model's levels only inside a running session.

Runner protocol v35: `session.setReasoning` takes `max` and `ultra`, and a newer client never sends them to an older runner.

The terminal’s Model reasoning picker reads and changes the active conversation on the runner. Picking a model in the terminal immediately lowers an unsupported effort, even before the next message. Runner protocol v36 lets the desktop keep a choice another client made on the running conversation. Explicitly resuming a conversation restores its saved model unless a model override is supplied.

New conversations using an OpenAI API key start on GPT-6 Luna when no model has been set. Adding or reordering catalog entries preserves this starting model.
