---
'@moxxy/desktop': patch
'@moxxy/cli': patch
---

Settings has a Jev section: paste the TypeSafe key, change it later, and switch Jev on or off without removing the key. The switch is a vault entry (`JEV_DISABLED`), so the desktop, the terminal and channel bots all read the same one, and with it off Computer Use works one action at a time as it does without a key. A run of steps also no longer clicks a control again when the click changed only the picture of the window: on a web page whose menu never reaches the accessibility tree, the second click closed the menu the first one opened, in a loop. The step now stops with the menu open and tells the model to continue by the screenshot.
