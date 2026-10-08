---
'@moxxy/cli': patch
---

The `terminal` tool no longer waits out its whole timeout after a command that reads the terminal input, such as an installer asking questions. In zsh and bash the shell now reports when it is back at its prompt, so the tool types only the command and its end marker is gone from the terminal.
