---
'@moxxy/plugin-provider-openai-codex': patch
'@moxxy/plugin-workflows': patch
---

Fix workflow_create failing with a 400 on the openai-codex provider: the ChatGPT-plan Codex `/responses` backend rejects `max_output_tokens` ("Unsupported parameter"), so the provider now drops `req.maxTokens` (one-shot MOXXY_DEBUG note) instead of forwarding it — same policy as `temperature`. workflow_create's draft call also clamps its token budget to the model's catalog ceiling and reports an actionable "draft hit the output-token limit" error when the YAML is truncated at `max_tokens`, instead of a cryptic parse failure.
