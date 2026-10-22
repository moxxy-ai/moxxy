---
"@moxxy/plugin-provider-codex-agent": patch
---

ChatGPT — Codex agent: the conversation's Codex thread now opens (and resumes) on the model the person picked in Moxxy. It used to open on the model from the person's Codex config and switch before the first turn, so Codex sent its model-switch instructions (about 4,000 tokens) with every request of the conversation. A model picked later in the conversation still switches the thread as before.
