# @moxxy/plugin-stt-local

## 0.47.0

### Patch Changes

- Updated dependencies [e62b8a4]
- Updated dependencies [1e49040]
- Updated dependencies [5f83fb5]
- Updated dependencies [3879896]
- Updated dependencies [24bd7f3]
  - @moxxy/model-fetch@0.2.1
  - @moxxy/sdk@0.47.0

## 0.46.0

### Patch Changes

- Updated dependencies [546836d]
  - @moxxy/sdk@0.46.0

## 0.45.0

### Minor Changes

- a3fbd14: Settings → Voice gets a Transcription choice: Cloud (OpenAI over the ChatGPT login, as before) or Local (Whisper turbo on this computer, offline once its model is on disk). The first switch to Local asks before it downloads the model (about 1 GB), then shows a progress bar with Cancel; the download runs in the background, so the app stays usable and the bar shows again when you come back to the tab. A toast says when Local is ready or why it could not start, and if it cannot start Moxxy stays on Cloud. The installer now ships the local Whisper plugin.

  Whisper turbo now downloads as its three files from Hugging Face, in parallel, pinned by size and sha256, instead of a `.tar.bz2` that had to be unpacked; that unpacking took about 67 s against 9 s for the download. Local Whisper offers only the multilingual turbo model: `tiny`, `base` and `small` are gone, and a config still naming one of them is rejected with a message listing `turbo`.

  The desktop shows toasts: a chat that finishes or asks while you are elsewhere in the app, and work the host finishes in the background (`app.notice`), shown as a toast while the window is in front and a system notification otherwise. Settings → Preferences → Notifications switches each kind on its own: "In-app toasts" for the notes inside Moxxy, and "System notification" for the macOS, Windows or Linux notification while Moxxy is in the background.

  `@moxxy/model-fetch` adds `ensureModelFiles` and `modelFilesReady` (also at `@moxxy/model-fetch/files`); `@moxxy/config` adds `clearCategoryDefault`.

### Patch Changes

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
- Updated dependencies [a3fbd14]
- Updated dependencies [6f4d652]
- Updated dependencies [d118b03]
- Updated dependencies [2160501]
- Updated dependencies [2b9c87f]
- Updated dependencies [332e4c2]
- Updated dependencies [a06de31]
- Updated dependencies [066a949]
- Updated dependencies [fa44b8c]
  - @moxxy/sdk@0.45.0
  - @moxxy/model-fetch@0.2.0

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
