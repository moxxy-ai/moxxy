---
'@moxxy/desktop': patch
---

Clicking a link to a local file in the chat opens it instead of crashing: media, images and documents open in their default app, anything that could run (scripts, apps, unknown types) and folders are shown in Finder (new host command `files.open`). The app also never hands its own pages to the default browser, which is what opened a broken copy of the app for an emptied link.
