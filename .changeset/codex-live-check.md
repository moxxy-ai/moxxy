---
---

Add a local-only live check for the ChatGPT-subscription provider (`pnpm test:live`) and an opt-in pre-push hook (`.githooks/pre-push`) that runs it when a push changes the Codex request path. It never runs in CI.
