---
'@moxxy/sdk': minor
'@moxxy/core': patch
'@moxxy/cli': patch
'@moxxy/plugin-provider-claude-code': patch
'@moxxy/plugin-scheduler': patch
'@moxxy/chat-model': patch
'@moxxy/client-core': patch
'@moxxy/desktop-ui': patch
'@moxxy/desktop': patch
---

Claude Agent: the times Claude sets itself to come back (ScheduleWakeup, `/loop`, CronCreate) show above the message box ("Back at 22:59 · in 3 min") and under "Scheduled" in the Agents pane, read from Claude's own list (`SessionInfo.scheduledWakeups`, runner protocol 31); the turn it comes back in reads "Scheduled check-in". The Agents pane and the background line are drawn with the app's own pieces, and the desktop's close, warning, check, fit and broadcast marks are icons rather than text glyphs. The cron parser moved to `@moxxy/sdk/cron`.
