---
'@moxxy/desktop': patch
---

A click on a link in the chat, the mini chat or the media library opens a small menu. For a page: open it in the Moxxy browser, open it in the default browser, or copy it; the mini chat offers only the default browser, since the Moxxy browser is in the main window. For a file: open it, show it in Finder (File Explorer on Windows), add it to the agent, or copy its path. Cmd-click (Ctrl-click off a Mac) opens the link at once, as before. A link to GitHub or a Google page no longer opens in a sign-in window of the app but in the default browser, and links in the mini chat open at all. Links to files on Windows (`C:\…`, `file:///C:/…`) open instead of saying the file does not exist, and a missing file now says "This file is not there". A Windows path with a dot or an underscore after a backslash (`C:\Users\Jan\.config`) keeps it.
