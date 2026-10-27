---
'@moxxy/desktop': patch
---

Coming back to a chat while its agent still works keeps showing it at work. The app read a reply marked as the end of the turn as the end, even with the turn's tool calls after it in the log; a turn now ends on a reply only when no work of the turn follows it.
