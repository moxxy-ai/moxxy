---
'@moxxy/desktop': patch
---

Updating to a release that needs the full app works on macOS. Moxxy crashed in the middle of it: the installer had grown past a gigabyte, and the part of the system that used to install it reads the whole download into memory. Moxxy now downloads the new app to disk, checks that it is signed by the same developer as the one running, and swaps the two as it closes, then opens the new one. The previous app is kept until the new one has started and is removed after that. When Moxxy cannot replace itself — a folder it cannot change, no room on the disk, a copy that is not signed — it says so before restarting and offers the download page.

Apps installed before this release get there too, without anyone reinstalling by hand. Their own installer step is the one that crashes, and no release can change an app that is already installed. So a release now reaches them as an ordinary update: after the restart the new version sees that the installed app is too old to run its agent, shows the installer screen, and installs the full app by itself with a second restart. If that cannot be done, "Not now" goes back to the version that was installed.
