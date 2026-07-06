# @moxxy/plugin-tts-openai

## 0.29.0

### Patch Changes

- Updated dependencies [d99087f]
- Updated dependencies [f360bf6]
  - @moxxy/sdk@0.29.0

## 0.28.1

### Patch Changes

- Updated dependencies [6c0af71]
  - @moxxy/sdk@0.28.1

## 0.28.0

### Patch Changes

- Updated dependencies [3e4b2b4]
- Updated dependencies [e4e2941]
  - @moxxy/sdk@0.28.0

## 0.27.0

### Minor Changes

- 2e37663: New `@moxxy/plugin-tts-openai` — the first Synthesizer backend. Text-to-speech via OpenAI's `POST /v1/audio/speech` (one JSON POST returning audio bytes, no `openai` SDK dependency). Registers a single `openai-tts` synthesizer that the `SynthesizerRegistry` auto-adopts as the active read-aloud voice on install; the agent switches via `set_voice`. Config surface: `model` (default `gpt-4o-mini-tts`), `voice` (default `alloy`), `format` (default `mp3` → `audio/mpeg`; also `opus`/`wav`/`aac`). `SynthesizeOptions.voice` overrides the configured voice, `rate` maps to OpenAI `speed` clamped to 0.25–4.0, `signal` cancels the request, and input over OpenAI's 4096-char limit is truncated at a sentence boundary with an ellipsis. The API key rides the vault (`OPENAI_API_KEY`, shared with the OpenAI provider) with a `process.env` fallback; a missing key and HTTP/network failures surface as classified `MoxxyError`s. Added to the plugins-admin install catalog as `tts-openai`.

### Patch Changes

- Updated dependencies [e791484]
- Updated dependencies [49b1d73]
- Updated dependencies [3b27404]
- Updated dependencies [0b6f40e]
- Updated dependencies [2cff46b]
- Updated dependencies [2cef8e1]
- Updated dependencies [98f545c]
- Updated dependencies [ee2967d]
- Updated dependencies [2a35357]
- Updated dependencies [67a3387]
- Updated dependencies [be28d55]
  - @moxxy/sdk@0.27.0
