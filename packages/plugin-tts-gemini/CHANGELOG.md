# @moxxy/plugin-tts-gemini

## 0.45.0

### Patch Changes

- 204c659: The read-aloud button under an answer now sends the whole message to Gemini TTS in one request instead of one request per sentence, so it no longer runs into Gemini's rate limit. A message longer than about 3,000 characters goes in a few large parts, cut between sentences. The speech is kept on disk in `$MOXXY_HOME/cache/speech` (up to 500 MB, the clips heard longest ago are deleted first), so hearing a message again plays at once and costs nothing. Piper and other voices, and Voice Mode, read sentence by sentence as before and keep nothing. `@moxxy/plugin-tts-gemini` exports `GEMINI_TTS_READ_ALOUD_PART_CHARS`.
- Updated dependencies [71f8aa8]
- Updated dependencies [db33b95]
- Updated dependencies [71e90e5]
- Updated dependencies [84ff880]
- Updated dependencies [b6c11c4]
- Updated dependencies [02119e8]
- Updated dependencies [29841af]
- Updated dependencies [211f80c]
- Updated dependencies [49dd789]
- Updated dependencies [90ab0bb]
- Updated dependencies [cb494ef]
- Updated dependencies [b6c11c4]
- Updated dependencies [887b8b7]
- Updated dependencies [072b8b5]
- Updated dependencies [a8e8418]
- Updated dependencies [322f2ce]
- Updated dependencies [7868760]
- Updated dependencies [4af5560]
- Updated dependencies [ee669b7]
- Updated dependencies [3c1527c]
- Updated dependencies [178a215]
- Updated dependencies [318d476]
- Updated dependencies [7cc93a2]
- Updated dependencies [6e54a6b]
- Updated dependencies [1329245]
- Updated dependencies [8472068]
- Updated dependencies [deeeeea]
- Updated dependencies [46b20d3]
- Updated dependencies [9bfe644]
- Updated dependencies [d2de3a1]
- Updated dependencies [7d718f6]
- Updated dependencies [6f4d652]
- Updated dependencies [d118b03]
- Updated dependencies [2160501]
- Updated dependencies [2b9c87f]
- Updated dependencies [332e4c2]
- Updated dependencies [a06de31]
- Updated dependencies [066a949]
- Updated dependencies [fa44b8c]
  - @moxxy/sdk@0.45.0

## 0.44.0

### Patch Changes

- Updated dependencies [d70839e]
  - @moxxy/sdk@0.44.0

## 0.43.0

### Patch Changes

- Updated dependencies [7b24827]
- Updated dependencies [45f501a]
- Updated dependencies [1c4d5aa]
- Updated dependencies [889810e]
- Updated dependencies [3b0fcdf]
- Updated dependencies [0a44449]
- Updated dependencies [235ae19]
- Updated dependencies [a501dbd]
  - @moxxy/sdk@0.43.0

## 0.42.1

### Patch Changes

- @moxxy/sdk@0.42.1

## 0.42.0

### Minor Changes

- 40b40f4: Add Google Gemini Flash-Lite speech synthesis with configurable cloud voices, interruption-aware sentence playback, and speech cleanup for links and file paths. Settings → Voice now holds everything voice in one place: the Voice Mode engine (Local / GPT-Live) and, for the Local engine, the spoken voice (Gemini Flash-Lite or Local Piper).

### Patch Changes

- Updated dependencies [1bde2f6]
- Updated dependencies [ac81f33]
- Updated dependencies [2f408fa]
- Updated dependencies [f44cf63]
- Updated dependencies [54d629a]
- Updated dependencies [ca9a67f]
- Updated dependencies [467542f]
- Updated dependencies [808bbfd]
- Updated dependencies [c329313]
- Updated dependencies [9cb28d6]
- Updated dependencies [bd8473c]
- Updated dependencies [40b40f4]
- Updated dependencies [194abc6]
- Updated dependencies [e825fa1]
- Updated dependencies [40d310e]
- Updated dependencies [5ca8fbe]
- Updated dependencies [c273722]
- Updated dependencies [5a18a15]
- Updated dependencies [97c44bd]
- Updated dependencies [8a10b7d]
- Updated dependencies [a34b1d7]
- Updated dependencies [1e5cb75]
- Updated dependencies [bf368a0]
- Updated dependencies [fe2eb5a]
- Updated dependencies [a34b1d7]
  - @moxxy/sdk@0.42.0
