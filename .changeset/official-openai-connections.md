---
'@moxxy/cli': minor
'@moxxy/desktop': minor
'@moxxy/sdk': minor
---

Replace the retired ChatGPT-token connection and transcription with official OpenAI API-key voice and Codex agent migration. Add shared Voice settings sections, concrete agent progress, and the stateless Responses API: always on OpenAI's own API; every other OpenAI-compatible server tries it first and falls back to Chat Completions when the server has no Responses route (Z.ai stays on Chat Completions; `api` in a provider's config pins either protocol). No paid-use confirmation dialog.

A config that still names the retired ChatGPT sign-in is saved as "ChatGPT — Codex agent" once the Codex agent starts, so the move and its notice happen once; without Codex the config is left alone and provider recovery explains the removal with the real reason. Startup no longer stops when installing the Codex agent fails offline for a profile that had the sign-in only as a fallback.

Expose the existing shared secret redactor at `@moxxy/sdk/redact` for browser consumers; voice progress masks credentials in commands, task descriptions and plan steps before shortening them.

Wait for the first plugin preparation before provisioning a provider, so saving an OpenAI key on first launch cannot race the installer's writes.
