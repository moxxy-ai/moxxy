---
'@moxxy/desktop': patch
---

The desktop app no longer gets stuck on "Waiting for workspace information…" at startup. While the first runner was still starting, the host reported no active workspace and the app dropped the one its saved workspace list had already chosen — so whether it opened depended on which answer arrived last, and a slow runner start meant a restart. The host now answers with the saved active session until its runner is up, and the app never clears a known workspace on an empty answer.
