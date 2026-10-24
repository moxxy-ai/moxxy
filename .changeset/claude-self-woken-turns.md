---
'@moxxy/cli': patch
'@moxxy/plugin-provider-claude-code': patch
'@moxxy/desktop': patch
---

Claude Agent: a turn Claude wakes itself up for (ScheduleWakeup, `/loop`) shows in the chat when it happens. Its result carries no origin, so Moxxy took it for the person's: from the second one on, each reply waited for the person's next message and answered it with the stale one.
