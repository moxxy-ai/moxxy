---
"@moxxy/cli": patch
---

OpenAI and ChatGPT sign-in (Codex) now list only the models OpenAI still serves — GPT-6 (Astra, Sol, Luna) and GPT-5.6 (Sol, Terra, Luna) — and add `gpt-6-sol` and `gpt-6-luna`. With an API key they have OpenAI's 1,050,000-token window; with ChatGPT sign-in every model uses the Codex backend's 272k window (less its 5% margin), so compaction starts in time. The API provider now defaults to `gpt-5.6-luna`, sends GPT-6 the right output-limit field, and sends Sol and Luna `reasoning_effort: "none"` when a turn has tools, which Chat Completions requires for them to call tools.
