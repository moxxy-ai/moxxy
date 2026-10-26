---
'@moxxy/cli': patch
'@moxxy/sdk': minor
'@moxxy/desktop': patch
---

When Claude, Codex or OpenCode uses the person's computer with its own tools, Moxxy now says so: the desktop shows the Computer Use strip at the top of the conversation ("Codex is using your computer", the app it last named, Stop to stop the turn), and the terminal a line above the prompt (Esc stops it). It shows from the agent's first computer call in the turn until the turn ends. The SDK exports `agentComputerUseOf`, and a provider can name its agent (`agentName`), which session info reports.
