# @moxxy/model-fetch

## 0.2.1

### Patch Changes

- e62b8a4: Make a test about stopping model downloads after one fails independent of timing: a download that starts after the failure counts as stopped too. No behaviour change.

## 0.2.0

### Minor Changes

- a3fbd14: Settings → Voice gets a Transcription choice: Cloud (OpenAI over the ChatGPT login, as before) or Local (Whisper turbo on this computer, offline once its model is on disk). The first switch to Local asks before it downloads the model (about 1 GB), then shows a progress bar with Cancel; the download runs in the background, so the app stays usable and the bar shows again when you come back to the tab. A toast says when Local is ready or why it could not start, and if it cannot start Moxxy stays on Cloud. The installer now ships the local Whisper plugin.

  Whisper turbo now downloads as its three files from Hugging Face, in parallel, pinned by size and sha256, instead of a `.tar.bz2` that had to be unpacked; that unpacking took about 67 s against 9 s for the download. Local Whisper offers only the multilingual turbo model: `tiny`, `base` and `small` are gone, and a config still naming one of them is rejected with a message listing `turbo`.

  The desktop shows toasts: a chat that finishes or asks while you are elsewhere in the app, and work the host finishes in the background (`app.notice`), shown as a toast while the window is in front and a system notification otherwise. Settings → Preferences → Notifications switches each kind on its own: "In-app toasts" for the notes inside Moxxy, and "System notification" for the macOS, Windows or Linux notification while Moxxy is in the background.

  `@moxxy/model-fetch` adds `ensureModelFiles` and `modelFilesReady` (also at `@moxxy/model-fetch/files`); `@moxxy/config` adds `clearCategoryDefault`.

## 0.1.0

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
