---
'@moxxy/cli': patch
---

The mobile channel now serves Computer Use status: `computer.snapshot` answers which app the agent is operating and in what state, and every change is pushed as `computer.changed`, the same state the desktop's control strip shows. Pause, resume and take over stay with the person at the computer; a phone stops a turn as before.
