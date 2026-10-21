---
---

Checks for the agent connections: a daily CI workflow that runs the newest and the minimum Claude Code, Codex and OpenCode against their connection's handshake and protocol with no sign-in (`pnpm test:agents:compat`), and a local live check that holds real conversations through all three on the developer's sign-ins before merging (`pnpm test:agents:live`, replacing the Claude-only smoke script).
