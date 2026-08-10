---
'@moxxy/desktop': minor
---

Voice Mode no longer replaces the conversation. Starting one now adds a 58px presence rail between the ask sheet and the composer, and leaves the header, the full transcript and the text composer exactly where they were — so a voice conversation is the same conversation with a microphone open: you can scroll back, search, open a tool result, and type. A message sent from the composer during a call runs as an ordinary turn and its answer is read back.

The rail carries the shared `MoxxyMark` between two fans of radio arcs that travel outward only while a voice is actually carrying, hairline-separated sections, and one operation at a time — the oldest still running, held in place while newer tools come and go, with the rest counted as `+N active` and a quiet "No tools running" holding the slot's shape when there is nothing to report. Microphone, waiting sound and ending the call stay reachable throughout, as do the Local Piper install prompt and the retry after a failure. The mark breathes with the voice through a single CSS custom property driving a scale and an opacity, so the animation is composited rather than painted and there is no canvas in the main window at all.

The full-screen surface it replaces is deleted, along with its particle hologram, sprite cache and orbit. Focus Mode is untouched.
