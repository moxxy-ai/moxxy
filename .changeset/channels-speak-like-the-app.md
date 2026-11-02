---
'@moxxy/cli': patch
'@moxxy/desktop': patch
'@moxxy/client-core': patch
---

Telegram and Discord voice replies, Discord voice calls and the terminal's read aloud now speak a reply the way the desktop does: a table row by row, an address as a link to its site, and a code block as "(code block)" (left out entirely in a Discord voice call, as in Voice Mode). The text cleanup now lives in one place, `@moxxy/chat-model`, for every surface.
