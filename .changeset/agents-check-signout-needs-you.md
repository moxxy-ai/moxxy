---
'@moxxy/desktop': minor
'@moxxy/desktop-host': minor
'@moxxy/client-core': minor
'@moxxy/desktop-ipc-contract': minor
'@moxxy/desktop-ui': patch
'@moxxy/cli': minor
'@moxxy/sdk': minor
'@moxxy/core': minor
'@moxxy/agent-connection-kit': minor
'@moxxy/plugin-provider-codex-agent': patch
'@moxxy/plugin-provider-claude-code': patch
'@moxxy/plugin-provider-acp': patch
---

Settings → Providers: one "Check for updates" button now sits on the "SDK · OAuth login" heading instead of hiding in each agent's menu, and the agents are checked again on their own when a sign-in from Settings ends and when you come back to the window (at most every 30 seconds), so a sign-in done in a terminal shows without a click. A signed-in agent's menu has "Sign out", which asks first and then signs Claude, Codex or OpenCode out the same way the terminal does (`provider.logout` runs `moxxy login logout <provider>`). In the chat list, a run that waits on you for an approval or a question says "Needs you" beside its name, with an amber dot on its avatar, so it no longer looks the same as a finished one.

Signing out first ends the agent's live sessions on every runner (runner protocol v34, `provider.closeAgentSessions`, backed by the new `agentCli.closeSessions` hook and `AgentSessionPool.endAll`): a running `codex app-server` holds the account and wrote it back after `codex logout`, so the agent stayed signed in. A sign-out waits while a turn runs.

