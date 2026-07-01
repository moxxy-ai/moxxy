---
'@moxxy/plugin-provider-openai-codex': patch
'@moxxy/cli': patch
'@moxxy/desktop': patch
---

Fix Codex `gpt-5.5` / `gpt-5.4` advertising a 1,000,000-token context window when the ChatGPT-plan Codex backend only serves ~400k for these gpt-5-family models. The inflated window pushed the proactive compactor's `estimatedTokens > 0.75 * contextWindow` gate out to ~750k — unreachable before the backend rejected the request — so long sessions always fell through to the reactive compact-on-overflow retry ("context window exceeded — compacted older turns, retrying") instead of compacting cleanly ahead of the limit. Set both to `400_000`, matching the rest of the Codex catalog, so the proactive compactor trips before overflow.
