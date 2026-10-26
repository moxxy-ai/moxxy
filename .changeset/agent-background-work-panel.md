---
'@moxxy/cli': patch
'@moxxy/sdk': minor
'@moxxy/desktop': minor
'@moxxy/agent-connection-kit': minor
---

You can now see what Claude's and Codex's background work does. The desktop's work panel has an Agents pane listing the chat's helpers and the commands the agent left running. Picking one opens its mini chat (the helper's task, what it said and the tools it called, its answer) or what a command printed when it ended, with Stop while it runs. "Agent continued" in the chat opens the work that ended there instead of repeating its name in a box, the pane can point back at that entry, and a line above the message box says what runs in the background. A helper's steps now show as they happen, not at the agent's next turn, and work the person stopped on Codex opens no empty "Agent continued" turn. Every surface reads the same records: the list of what runs now is part of the session's info, so a restarted runner shows nothing stale running.

The SDK adds the `subagent_message`, `background_work` and `background_work_ended` agent step events, `subagent_completed.stopped`, `AgentBackgroundWork`, `AgentWorkEnd`, `AgentActivity`, `agentActivityRecord`, `isAgentWorkEvent`, `isSubagentEvent` (also in the browser-safe `@moxxy/sdk/agent-work` entry), `LLMProvider.onAgentActivity` and `stopBackgroundWork`, `AgentTurnStart.workId`, `TriggerOrigin.workId`, `SessionInfo.backgroundWork` and `ClientSession.stopBackgroundWork`. Runner protocol v29 adds `session.stopBackgroundWork`. `@moxxy/agent-connection-kit`'s `AgentSessionPool` gains `onActivity`, `activity` and `running`.
