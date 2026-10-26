---
'@moxxy/cli': patch
'@moxxy/sdk': minor
'@moxxy/desktop': patch
---

Claude and Codex now say how much of the person's plan is left. From three quarters of a window used, a line above the message box says so ("Claude has used 94% of its weekly limit · resets Sat at 08:00"); once the limit is used up, the turn ends with a note saying which limit and when it resets, instead of the agent's raw error, and the line turns red until then. The terminal shows the same line and note, and the phone app, Telegram and Discord the note, all from the same record in the conversation. The SDK adds the `account_limit` agent step event, `AgentAccountLimit`, `recordedAccountLimit`, `accountLimitOfEvent`, `accountLimitInForce`, `sameAccountLimit`, the `@moxxy/sdk/agent-account-limit` entry and `LLMProvider.agentName`.
