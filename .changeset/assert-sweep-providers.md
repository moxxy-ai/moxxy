---
'@moxxy/plugin-provider-anthropic': patch
'@moxxy/plugin-provider-claude-code': patch
'@moxxy/plugin-provider-openai': patch
'@moxxy/plugin-provider-openai-codex': patch
'@moxxy/plugin-provider-xai': patch
'@moxxy/plugin-embeddings-openai': patch
'@moxxy/plugin-embeddings-transformers': patch
'@moxxy/plugin-memory': patch
'@moxxy/plugin-mcp': patch
'@moxxy/plugin-browser': patch
'@moxxy/plugin-view': patch
'@moxxy/plugin-terminal': patch
'@moxxy/plugin-collab': patch
'@moxxy/plugin-stt-whisper': patch
'@moxxy/plugin-stt-whisper-codex': patch
'@moxxy/plugin-voice-admin': patch
---

Replace non-null assertions and depth-≥2 optional chains with explicit guards (`invariant`/`assertDefined` from `@moxxy/sdk`) across the provider, embeddings, memory, mcp, browser, view, terminal, collab, stt, and voice-admin plugins. Behavior-preserving: normal-absence paths (streaming heartbeats, optional hooks, best-effort cleanup) keep their silent skips; only impossible-by-construction absences now fail loudly at the assumption site.
