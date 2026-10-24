---
'@moxxy/sdk': minor
'@moxxy/cli': patch
'@moxxy/desktop': patch
---

The Claude, Codex and OpenCode agent connections offer the models the agent itself offers: with the hourly CLI check Moxxy asks Claude (`supportedModels()`), Codex (`model/list`) and OpenCode (`opencode models`), so GPT-6.1 Sol, Haiku 5.5 and every OpenCode model show as they do in the CLIs, also while another connection runs the conversation. The usage bar shows the context window the agent reports it runs the model with (Codex `modelContextWindow`, Claude `modelUsage`, OpenCode `usage_update`), recorded in the log as a new `context_window` agent step event. The built-in lists, used until the agent answers, add `gpt-6.1-sol` (500k), start the other GPT-6 models at Codex's 272k, and replace Claude Haiku 4.5 with 5.5 (1M window, 128k output); an unknown Claude or Codex model starts at 400k, an OpenCode model at 200k. The desktop's context bar on an agent connection shows how full the agent's context is (Claude's last call, OpenCode's `usage_update.used`, Codex's last call, as a new `context_used` agent step event and `provider_response.contextTokens`) instead of the usage the whole turn added up, which showed 100% after a few tool steps.
