---
'@moxxy/desktop': patch
---

One click on "Update" now brings everything up to date and restarts Moxxy: the app, the runner and the installed extensions. Extensions used to stay on the version first installed, so fixes in them — such as the terminal no longer waiting out its timeout — never reached existing installs, and the update banner asked for a second click to relaunch. Each part is installed and checked next to the one in use and only then swapped in, keeping the previous copy; if anything fails nothing changes, Moxxy keeps working as before and the banner offers another try. Workspaces, sessions, keys and settings are never touched. After an update the app no longer offers to replace a newer OpenAI connection with the older one it shipped with.
