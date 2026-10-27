---
'@moxxy/cli': minor
'@moxxy/desktop': minor
'@moxxy/sdk': minor
---

Replace the retired ChatGPT-token connection and transcription with official OpenAI API-key voice and Codex agent migration. Add shared Voice settings sections, concrete agent progress, and stateless Responses API for OpenAI, xAI and Ollama. No paid-use confirmation dialog.

Expose the existing shared secret redactor at `@moxxy/sdk/redact` for browser consumers; voice progress masks credentials in commands, task descriptions and plan steps before shortening them.

Wait for the first plugin preparation before provisioning a provider, so saving an OpenAI key on first launch cannot race the installer's writes.
