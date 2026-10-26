---
'@moxxy/cli': patch
---

The auto-approve switch of a conversation on Codex or OpenCode stays as the person left it when Moxxy starts a new agent process that picks the conversation up (after a restart, or when Codex reloads its tools), and the agent runs that way. Before, the new process put back how the agent's own config runs: auto-approve turned on was shown off while Codex still ran without asking, and auto-approve turned off came back on, so the agent worked without asking against the person's choice. A resumed Codex thread keeps the approval policy Moxxy last set on it but takes its sandbox from the config again, so Moxxy now reads the person's own setup from Codex's config instead of from the resumed thread.
