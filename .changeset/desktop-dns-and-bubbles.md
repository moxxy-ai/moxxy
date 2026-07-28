---
'@moxxy/desktop': patch
---

Fix the blank desktop window, and drop the chat bubble for plain text.

**Blank window.** The packaged app serves its renderer from a loopback HTTPS server at `https://desktop.moxxy.ai:<port>`, because a Clerk production key rejects any Origin that is not a `moxxy.ai` host. Resolving that name was left to a public DNS A-record pointing at 127.0.0.1, so every installed copy depended on one record staying alive. It stopped resolving, and every app opened to an empty window with only `ERR_NAME_NOT_RESOLVED` in a log nobody reads.

Chromium now maps that one hostname to loopback itself, set in the bootstrap prologue (before the network stack initialises, and inside the immutable floor so a bad hot-update cannot remove the rule the app needs to load its own UI). The app no longer needs DNS to start, which also means it opens offline, on a filtered corporate resolver, and cannot be pointed elsewhere by whoever controls the zone. A test keeps the duplicated hostname literal in step with `DESKTOP_APP_HOST`.

**Chat bubble.** A user prompt rendered as a gradient-filled rounded bubble with white ink, a text-shadow and a drop shadow, all to keep one short line readable against itself. Right alignment already says whose turn it is, so it is now just text.
