# @moxxy/plugin-tts-local

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
