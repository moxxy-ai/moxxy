# @moxxy/plugin-tts-local

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

- bba28c0: feat(voice): @moxxy/plugin-tts-local — offline Piper TTS (EN+PL) with on-demand verified model downloads

  Adds a fully local, on-device text-to-speech Synthesizer plus the shared
  download-and-verify helper it relies on:

  - `@moxxy/model-fetch` — HTTPS download with a host allow-list, streamed
    mandatory-sha256 verification, `.partial`→atomic-rename publish, a size cap,
    throttled progress, and hardened `.tar.bz2` extraction (path-traversal /
    symlink rejection). `ensureModel` ties download + extract behind an
    idempotent marker.
  - `@moxxy/plugin-tts-local` — the `local-piper` synthesizer running sherpa-onnx
    Piper voices (English + Polish) in a forked sidecar (so the native addon's
    shared libs resolve via `DYLD_/LD_LIBRARY_PATH` set at process start). Voice
    models download once on first use from sherpa-onnx's pinned releases,
    sha256-verified against its `checksum.txt`. No API key, no network at
    synthesis time. Consumed transparently by desktop read-aloud, the TUI, and
    channel voice replies via the runner-side SynthesizerRegistry.

  plugins-admin gains a `tts-local` catalog entry for install-on-first-use.

### Patch Changes

- Updated dependencies [3e4b2b4]
- Updated dependencies [e4e2941]
- Updated dependencies [bba28c0]
  - @moxxy/sdk@0.28.0
  - @moxxy/model-fetch@0.1.0
