---
'@moxxy/desktop': patch
---

Show a stop control while Focus Mode is dictating. The microphone button kept
drawing a microphone once capture was live, so a control that would END the
recording looked exactly like one that would start it, and the only hint that a
second press was needed lived in the accessible name. It now switches to the
stop glyph and reads as pressed for as long as it is listening, matching the
voice mode button beside it. The transcribing state keeps its own indicator.
