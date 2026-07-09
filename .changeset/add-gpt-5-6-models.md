---
'@moxxy/plugin-provider-openai': minor
'@moxxy/plugin-provider-openai-codex': minor
---

Add the GPT-5.6 model family (Sol, Terra, Luna; GA July 9 2026) to both the OpenAI API provider and the Codex (ChatGPT-plan) provider. API model ids `gpt-5.6-sol` / `gpt-5.6-terra` / `gpt-5.6-luna` — flagship / balanced / fast-cheap — each a reasoning model with a 1,050,000-token window and 128k max output (Codex serves the same ids capped at the ChatGPT-plan ~400k window). The Codex default model moves to `gpt-5.6-sol`, matching OpenAI's own Codex default.
