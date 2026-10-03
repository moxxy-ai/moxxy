---
'@moxxy/cli': patch
---

Computer Use runs no longer repeat what must happen once: a key step ignores a target the model wrote into it and is pressed once (a second `super+n` opened another window), and typing is not repeated once its text is in the field (it used to append the text twice). A key after which another window is in front counts as done instead of stopping the run, and the model is told to ask for full control of a browser before a run that types into it.
