---
'@moxxy/cli': patch
---

Computer Use on macOS guards save dialogs. Typing, pasting or setting a name in a save dialog, and pressing Save or Return in it, is refused when the file would land in a protected place: login items (LaunchAgents/LaunchDaemons), shell start-up files, SSH/GPG/cloud keys, git hooks and config, virtualenv `activate` scripts, or a file that runs when opened (`.command`, `.webloc`, `.mobileconfig`, …). Names are compared the way the file system sees them (case, look-alike and invisible characters, trailing dots and spaces), and the model is told to pick another name or folder or ask the user.
