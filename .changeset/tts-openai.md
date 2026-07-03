---
'@moxxy/plugin-tts-openai': minor
'@moxxy/plugin-plugins-admin': patch
---

New `@moxxy/plugin-tts-openai` — the first Synthesizer backend. Text-to-speech via OpenAI's `POST /v1/audio/speech` (one JSON POST returning audio bytes, no `openai` SDK dependency). Registers a single `openai-tts` synthesizer that the `SynthesizerRegistry` auto-adopts as the active read-aloud voice on install; the agent switches via `set_voice`. Config surface: `model` (default `gpt-4o-mini-tts`), `voice` (default `alloy`), `format` (default `mp3` → `audio/mpeg`; also `opus`/`wav`/`aac`). `SynthesizeOptions.voice` overrides the configured voice, `rate` maps to OpenAI `speed` clamped to 0.25–4.0, `signal` cancels the request, and input over OpenAI's 4096-char limit is truncated at a sentence boundary with an ellipsis. The API key rides the vault (`OPENAI_API_KEY`, shared with the OpenAI provider) with a `process.env` fallback; a missing key and HTTP/network failures surface as classified `MoxxyError`s. Added to the plugins-admin install catalog as `tts-openai`.
