---
'@moxxy/cli': patch
---

The `terminal` tool returns as soon as its command ends in a zsh that sets the window title (Oh My Zsh and similar). The title sequence the shell prints right before each command's output hid the end-of-command marker, so every call — even `echo` — waited out its full 30 s timeout. The tool's result is now plain text, without color codes or title sequences.
