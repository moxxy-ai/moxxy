---
"@moxxy/cli": minor
---

Add four built-in LLM providers, available out of the box (no `provider_add`
needed) and selectable in `moxxy init` / the `/model` picker:

- **z.ai (Zhipu GLM)** in two modes — `zai` (pay-as-you-go, OpenAI-compatible
  endpoint) and `zai-coding-plan` (GLM Coding Plan, Anthropic-compatible
  endpoint, like Claude Code). Catalog: GLM-5.2 (1M context), GLM-5.1, GLM-5,
  GLM-4.6, GLM-4.5 family, GLM-4.5V (vision).
- **xAI (Grok)** — `xai`, OpenAI-compatible. Catalog: grok-4.3 (1M context),
  grok-4, grok-4-fast, grok-code-fast-1, grok-3, grok-3-mini.
- **Google Gemini** — `google`, via Gemini's OpenAI-compatibility endpoint.
  Catalog: gemini-3-pro/flash, gemini-2.5-pro/flash/flash-lite.
- **Local models** — `local`, any OpenAI-compatible local server (Ollama by
  default, or LM Studio / llama.cpp / vLLM via `LOCAL_MODEL_BASE_URL`). Needs no
  API key.

Also refreshes the Anthropic model catalog with the latest Claude models
(Claude Fable 5, Opus 4.8, Opus 4.6 alongside the existing Opus 4.7, Sonnet 4.6,
Haiku 4.5), which the `anthropic` and `claude-code` providers both pick up.
