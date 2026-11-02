---
'@moxxy/chat-model': patch
'@moxxy/client-core': patch
'@moxxy/desktop': patch
'@moxxy/cli': patch
---

Read aloud no longer stalls for seconds on a reply built to be slow, such as a long run of spaces in a table, commas after a link, unclosed brackets or a long path. Every check that prepares text for speech now takes time in step with the length of the text.
