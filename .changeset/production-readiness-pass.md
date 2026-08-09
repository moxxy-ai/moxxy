---
'@moxxy/client-platform-web': patch
'@moxxy/desktop': minor
---

Close out the three items standing between Voice Mode and a production build.

**Markdown re-parsing.** A CPU profile of a live streaming turn — taken through CDP against the running app, not a harness — put react-markdown, remark-gfm and micromark at the top of the renderer, which was 83% busy at peak. Rendered Markdown re-parses in full on every render, and a streaming turn re-renders the transcript on every delta, so every visible message in the conversation was re-parsing on every delta. `MarkdownBody` is now memoised and the parse itself sits behind its own memo boundary, so an unchanged message costs nothing. The message that IS growing is re-parsed on an interval rather than per delta, and that interval stretches with its length, which keeps the share of the renderer spent parsing flat instead of growing with the answer.

**Audio device changes.** The shared `AudioContext` is bound to the device it was built on, so plugging in headphones mid-conversation could leave it feeding a device that is gone. A `devicechange` listener now retires it — but only detaches it, so the sentence playing right now finishes on the context it started on and the old device is closed by that clip rather than under it.

**The retired mascot.** The `brick-girl` avatar subsystem had no consumer left after Focus Mode moved to the Moxxy mark; its two modules, two test files and five frames are removed (recoverable from history).
