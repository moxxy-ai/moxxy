---
'@moxxy/client-platform-web': patch
'@moxxy/desktop': patch
---

Two fixes underneath Voice Mode, both found by profiling the running app rather than a harness.

**Markdown re-parsing.** Rendered Markdown re-parses in full on every render, and a streaming turn re-renders the transcript on every delta, so every visible message in the conversation was re-parsing on every delta. `MarkdownBody` is now memoised and the parse sits behind its own memo boundary, so an unchanged message costs nothing. The message that IS growing is re-parsed on an interval derived from how long its previous parse actually took, which holds parsing at about a fifth of the renderer whatever the answer's length or structure.

**Audio.** Piper streams a sentence at a time and each clip built and closed its own `AudioContext`, tearing the audio device down and reopening it between every sentence. One context is now kept warm for the session, released and rebuilt when the output device changes — detached rather than closed, so the sentence playing right now finishes on the device it started on. Closing the context per clip had also been what released the clip's `<audio>` element; that is now explicit on every finish path, so a long conversation no longer leaves a decoded sentence per element waiting on the collector.
