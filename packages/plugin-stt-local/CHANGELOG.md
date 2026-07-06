# @moxxy/plugin-stt-local

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

### Minor Changes

- d47214f: feat(voice): @moxxy/plugin-stt-local — offline Whisper STT (multilingual) with on-demand verified model downloads

  Adds a fully local, on-device speech-to-text Transcriber — the input sibling of
  `@moxxy/plugin-tts-local`:

  - `@moxxy/plugin-stt-local` — the `local-whisper` transcriber running sherpa-onnx
    multilingual Whisper (English + Polish are the priority) in a forked sidecar
    (so the native addon's shared libs resolve via `DYLD_/LD_LIBRARY_PATH` set at
    process start). Models (`tiny` / `base` / `small`; default `base`, `small`
    recommended for Polish) download once on first use from sherpa-onnx's pinned
    `asr-models` release, sha256-verified against its `checksum.txt`. No API key,
    no network at transcription time.
  - Inbound audio is decoded to the Float32 mono @ 16 kHz sherpa wants: raw PCM16
    (the mic contract) and 16-bit PCM WAV are converted + resampled IN-PROCESS
    (no ffmpeg); compressed containers (ogg/opus voice notes, mp3, m4a, webm) go
    through ffmpeg when present, and raise a clear install-hint error when it
    isn't — raw PCM / WAV keep working regardless.
  - Registered side-effect free (no auto-adopt); the host/user activates it via
    `session.transcribers.setActive('local-whisper', { model, language })`.
    Channel voice notes (Telegram) consume the active transcriber transparently.

  plugins-admin gains an `stt-local` catalog entry for install-on-first-use.

### Patch Changes

- Updated dependencies [3e4b2b4]
- Updated dependencies [e4e2941]
- Updated dependencies [bba28c0]
  - @moxxy/sdk@0.28.0
  - @moxxy/model-fetch@0.1.0
