---
'@moxxy/cli': patch
---

Convert the telegram + Codex-OAuth Whisper transcriber plugins to discovery-loadable default exports (`telegramPlugin`, `whisperCodexPlugin`) that resolve the vault from the inter-plugin service registry in `onInit` instead of a `build*({ vault })` closure, declaring `@moxxy/plugin-vault` as a requirement for ordering. The `build*` factories are kept for direct injection. Same pattern as `@moxxy/plugin-oauth` — extending the onInit refactor wave across the channel + transcriber plugin kinds.
