# @moxxy/plugin-tts-elevenlabs

## 0.28.1

### Patch Changes

- Updated dependencies [6c0af71]
  - @moxxy/sdk@0.28.1

## 0.28.0

### Minor Changes

- 534e3aa: New `@moxxy/plugin-tts-elevenlabs` — a second Synthesizer backend alongside OpenAI TTS. Text-to-speech via ElevenLabs' `POST /v1/text-to-speech/{voiceId}` (one JSON POST with an `xi-api-key` header returning audio bytes, no vendor SDK dependency). Registers a single `elevenlabs` synthesizer that the `SynthesizerRegistry` can adopt as the active read-aloud voice; the agent switches via `set_voice`. Config surface: `voiceId` (default Rachel `21m00Tcm4TlvDq8ikWAM`), `model` (default `eleven_multilingual_v2`), `format` (default `mp3_44100_128` → `audio/mpeg`; also `mp3_44100_64` / `mp3_22050_32`, all mp3 → `audio/mpeg`). `SynthesizeOptions.voice` overrides the configured voice id; `rate` is intentionally ignored (ElevenLabs has no stable model-agnostic speaking-rate parameter); `signal` cancels the request; input over a conservative 2500-char cap is truncated at a sentence boundary with an ellipsis. Headerless PCM/µ-law formats and opus are deliberately omitted (raw PCM has no container; the opus token is not confidently known for this endpoint) rather than surfaced under a bogus MIME type. The API key rides the vault (`ELEVENLABS_API_KEY`) with a `process.env` fallback; a missing key and HTTP/network failures surface as classified `MoxxyError`s. Setup declares one required secret field, so skipping setup correctly leaves the package disabled. Added to the plugins-admin install catalog as `tts-elevenlabs`.

### Patch Changes

- Updated dependencies [3e4b2b4]
- Updated dependencies [e4e2941]
  - @moxxy/sdk@0.28.0
