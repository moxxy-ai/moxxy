---
'@moxxy/desktop': patch
---

The desktop app no longer waits on the "Install the bundled … connection update?" question before it starts a conversation. The question used to be asked before the first runner, in a dialog that could sit hidden behind the window, so the app stayed on "Waiting for workspace information…" until someone found and answered it. Now the app starts right away on the installed extension, the question appears attached to the main window, and an approved update installs and reconnects the open conversations. The Computer Use update on Windows works the same way.
