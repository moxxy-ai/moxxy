---
'@moxxy/cli': patch
'@moxxy/sdk': patch
---

The agent stops less often at the first failed step to ask whether it should go on. Every model request now carries a rule (in `AGENT_CONDUCT`) to try another route before ending the turn and to take the next step instead of offering it, while still asking for what only the user has and before anything that cannot be undone. The built-in `self-heal` skill now covers only Moxxy's own broken parts — a plugin, MCP server, provider or permission rule — so an ordinary error in a task no longer ends in a proposal that waits for approval. On macOS, Computer Use no longer ends the turn when the app it was asked to use has no open window; it opens one and carries on.
