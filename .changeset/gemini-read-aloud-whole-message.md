---
'@moxxy/desktop': patch
'@moxxy/plugin-tts-gemini': patch
---

The read-aloud button under an answer now sends the whole message to Gemini TTS in one request instead of one request per sentence, so it no longer runs into Gemini's rate limit. A message longer than about 3,000 characters goes in a few large parts, cut between sentences. The speech is kept on disk in `$MOXXY_HOME/cache/speech` (up to 500 MB, the clips heard longest ago are deleted first), so hearing a message again plays at once and costs nothing. Piper and other voices, and Voice Mode, read sentence by sentence as before and keep nothing. `@moxxy/plugin-tts-gemini` exports `GEMINI_TTS_READ_ALOUD_PART_CHARS`.
