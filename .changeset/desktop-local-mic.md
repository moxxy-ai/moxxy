---
'@moxxy/desktop': minor
'@moxxy/desktop-host': patch
'@moxxy/desktop-ipc-contract': patch
---

feat(desktop): route the mic through the runner's active transcriber (local STT) with Codex fallback

The desktop microphone was hardwired to the in-process Codex cloud transcriber.
It now prefers the RUNNER's active transcriber — a runner-side STT plugin such
as the local Whisper `@moxxy/plugin-stt-local` — so with that plugin installed
and active the desktop mic transcribes **fully offline**. Without it, behavior
is byte-identical to before.

- `session.transcribe` (desktop-host IPC) tries the runner's active transcriber
  first via the existing `Transcribe` runner RPC (`RemoteSession.transcribers.
  tryGetActive()`, mirroring how `session.synthesize` routes TTS). It falls back
  to the in-process Codex transcriber only when the runner reports **no active
  transcriber**. An error from a *present-but-failing* runner transcriber (a
  broken local model) surfaces to the user instead of silently falling through
  to the cloud — "none active" and "failed" are distinguished.
- `session.hasTranscriber` (the mic-affordance gate) is now true when EITHER the
  runner reports an active transcriber (read off the existing
  `SessionInfo.activeTranscriber` snapshot — no new RPC) OR the Codex OAuth vault
  probe passes. Keyed on the ACTIVE transcriber so it stays in lockstep with the
  transcribe routing.
- `session.transcribe` gains an optional `workspaceId` (like `session.synthesize`)
  so a background workspace's mic targets the right runner; the renderer is
  unchanged and defaults to the active workspace.

No runner-protocol change: the `Transcribe` RPC, its handler, and the
`RemoteSession` transcriber proxy already existed and are unchanged, so
`RUNNER_PROTOCOL_VERSION` is not bumped. The mic capture's `audio/x-moxxy-pcm16-
24khz` (PCM16 24 kHz) mimeType flows through to whichever transcriber unchanged.
