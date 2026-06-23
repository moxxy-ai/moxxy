---
"@moxxy/workspaces-app": patch
---

Mobile: show a Stop button for the whole turn so a running agent/workflow can be cancelled.

The composer's primary action only became Stop during the brief send round-trip
(`sending`), so once the agent moved into a long thinking/tool/subagent run the
button flipped back to Send and there was no way to cancel from the phone. It now
follows the whole turn (`activeTurnId !== null || sending`) — matching desktop —
and presses through to the existing `abort()` (which already cancels spawned
subagents via the parent turn signal).
