---
'@moxxy/plugin-stt-local': minor
'@moxxy/model-fetch': minor
'@moxxy/config': patch
'@moxxy/desktop': minor
---

Settings → Voice gets a Transcription choice: Cloud (OpenAI over the ChatGPT login, as before) or Local (Whisper turbo on this computer, offline once its model is on disk). The first switch to Local asks before it downloads the model (about 1 GB), then shows a progress bar with Cancel; the download runs in the background, so the app stays usable and the bar shows again when you come back to the tab. A toast says when Local is ready or why it could not start, and if it cannot start Moxxy stays on Cloud. The installer now ships the local Whisper plugin.

Whisper turbo now downloads as its three files from Hugging Face, in parallel, pinned by size and sha256, instead of a `.tar.bz2` that had to be unpacked; that unpacking took about 67 s against 9 s for the download. Local Whisper offers only the multilingual turbo model: `tiny`, `base` and `small` are gone, and a config still naming one of them is rejected with a message listing `turbo`.

The desktop shows toasts: a chat that finishes or asks while you are elsewhere in the app, and work the host finishes in the background (`app.notice`), shown as a toast while the window is in front and a system notification otherwise. Settings → Preferences → Notifications switches each kind on its own: "In-app toasts" for the notes inside Moxxy, and "System notification" for the macOS, Windows or Linux notification while Moxxy is in the background.

`@moxxy/model-fetch` adds `ensureModelFiles` and `modelFilesReady` (also at `@moxxy/model-fetch/files`); `@moxxy/config` adds `clearCategoryDefault`.
