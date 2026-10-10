---
'@moxxy/cli': patch
---

Moxxy Browser now says when a switch on a page is off (`[not pressed]`) and when a text field is locked (`[read-only]`). Before, a switch that was off read like any button: after switching one off the agent could not see that it worked, pressed it again and saved the setting switched back on. A locked field read like any field: the agent typed into it twice, saw the old text stay, and saved the form without the change instead of pressing the Edit button beside it.
