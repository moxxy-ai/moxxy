---
"@moxxy/sdk": minor
"@moxxy/cli": patch
"@moxxy/plugin-provider-anthropic": patch
"@moxxy/plugin-provider-openai": patch
"@moxxy/plugin-provider-google": patch
"@moxxy/plugin-provider-xai": patch
"@moxxy/plugin-provider-zai": patch
"@moxxy/plugin-provider-local": patch
"@moxxy/plugin-provider-claude-code": patch
"@moxxy/plugin-provider-openai-codex": patch
---

Move provider credential resolution and onboarding metadata to provider-owned contracts and manifests. Unbundled configured providers are installed automatically on first use, while diagnostics now share activation credential semantics and verify both audio capture and transcription readiness.
