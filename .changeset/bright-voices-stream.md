---
'@moxxy/cli': minor
'@moxxy/desktop': minor
---

Add a hands-free desktop Voice Mode across the full chat and Focus Mode with reliable per-fragment Polish/English Local Piper routing, deterministic conversational prosody, natural bilingual long-running activity updates, the compact UI SFX processing loop that starts during transcription and has a persistent sound control, code- and emoji-free conversational speech, voice activity detection, echo-aware automatic barge-in that stops Piper and the interrupted turn without losing the new utterance, a theme-aligned audio-reactive call screen with safe live tool activity, compact background-call controls, a bidirectional microphone/Piper waveform in Focus Mode, a persistent, unambiguous microphone mute control, and StrictMode-safe transfer of an active call into an immediately expanded Focus Mode without restarting its audio or turn; also fix Electron and packaged-CSP Piper playback failures, honor the configured synthesizer at session start, and make desktop dev use the freshly built monorepo CLI.

When Local Piper is absent, the full desktop Voice Mode explains the one-time offline voice requirement and offers a safe one-click installation that enables the synthesizer, selects it as the default, restarts the runners, and resumes the call automatically. Focus Mode exposes its compact Voice Mode control only after Local Piper is confirmed installed, keeping first-time setup out of the constrained floating surface.
