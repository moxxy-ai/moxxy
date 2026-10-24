---
'@moxxy/cli': minor
'@moxxy/sdk': minor
'@moxxy/desktop': minor
---

Keep the Claude, Codex and OpenCode CLIs installed and up to date. Moxxy checks them at start and every hour (installed, signed in, and against the vendor's latest on npm) and keeps the answer in the session, so every surface says the same: a line above the prompt in the TUI, a line above the message box in the desktop (closable for an optional update until the next version), connection rows in Settings → Providers and in first-run setup with install and update and a progress bar, `moxxy doctor`, and the new `moxxy agents status|install|update`. Installs use the vendor's installer and updates the agent's own command; a CLI older than the versions Moxxy was checked against must be updated first, and the desktop never updates one during a turn. The SDK adds `ProviderDef.agentCli`, `AgentCliReport`, `fetchNpmLatest` and `killTree`; runner protocol 28 adds `provider.checkAgents`.
