# @moxxy/plugin-stt-local

## 0.35.3

### Patch Changes

- @moxxy/sdk@0.35.3

## 0.35.2

### Patch Changes

- @moxxy/sdk@0.35.2

## 0.35.1

### Patch Changes

- @moxxy/sdk@0.35.1

## 0.35.0

### Patch Changes

- Updated dependencies [57f0810]
  - @moxxy/sdk@0.35.0

## 0.34.0

### Patch Changes

- Updated dependencies [ae16897]
- Updated dependencies [d9ae119]
- Updated dependencies [6d8fdcd]
- Updated dependencies [220673e]
- Updated dependencies [b25850c]
- Updated dependencies [63b1df5]
- Updated dependencies [3dfc2f3]
- Updated dependencies [e52e2ed]
- Updated dependencies [e52e2ed]
- Updated dependencies [06e81f8]
  - @moxxy/sdk@0.34.0

## 0.33.0

### Patch Changes

- Updated dependencies [b241085]
  - @moxxy/sdk@0.33.0

## 0.32.0

### Patch Changes

- Updated dependencies [3b0c14a]
  - @moxxy/sdk@0.32.0

## 0.31.0

### Patch Changes

- Updated dependencies [8bb26b1]
- Updated dependencies [43926ab]
  - @moxxy/sdk@0.31.0

## 0.30.0

### Patch Changes

- Updated dependencies [c124a15]
  - @moxxy/sdk@0.30.0

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
