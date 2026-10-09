# @moxxy/plugin-stt-local

## 0.42.1

### Patch Changes

- @moxxy/sdk@0.42.1

## 0.42.0

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

## 0.41.3

### Patch Changes

- Updated dependencies [6fefc59]
  - @moxxy/sdk@0.41.3

## 0.41.2

### Patch Changes

- @moxxy/sdk@0.41.2

## 0.41.1

### Patch Changes

- @moxxy/sdk@0.41.1

## 0.41.0

### Patch Changes

- Updated dependencies [9039517]
- Updated dependencies [c6ee82d]
- Updated dependencies [b01809e]
- Updated dependencies [46136ab]
- Updated dependencies [f13cda7]
- Updated dependencies [ba473d9]
  - @moxxy/sdk@0.41.0

## 0.40.0

### Patch Changes

- Updated dependencies [7e47604]
  - @moxxy/sdk@0.40.0

## 0.39.0

### Patch Changes

- Updated dependencies [1d983d9]
  - @moxxy/sdk@0.39.0

## 0.38.0

### Patch Changes

- Updated dependencies [971fd32]
  - @moxxy/sdk@0.38.0

## 0.37.2

### Patch Changes

- Updated dependencies [84dd2c5]
  - @moxxy/sdk@0.37.2

## 0.37.1

### Patch Changes

- Updated dependencies [e80b9d6]
- Updated dependencies [abd9482]
- Updated dependencies [5e4ca9f]
  - @moxxy/sdk@0.37.1

## 0.37.0

### Patch Changes

- Updated dependencies [78938f8]
  - @moxxy/sdk@0.37.0

## 0.36.1

### Patch Changes

- @moxxy/sdk@0.36.1

## 0.36.0

### Patch Changes

- Updated dependencies [bc7844e]
  - @moxxy/sdk@0.36.0

## 0.35.4

### Patch Changes

- @moxxy/sdk@0.35.4

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
