---
'@moxxy/plugin-cli': patch
---

TUI read-aloud: a `/speak` command that voices the assistant's reply through
the session's active `Synthesizer`. Bare `/speak` speaks the last reply;
`/speak on|off` toggles sticky auto-speak of each final reply (in-memory, per
TUI session); `/speak stop` halts current playback. Synthesis reuses
`@moxxy/channel-kit`'s transport-agnostic `synthesizeReply`/`toSpeech`, and a
new `audio-play` helper plays the bytes through the platform's system player —
`afplay` (macOS), `paplay`/`aplay`/`ffplay` (Linux), or PowerShell
`Media.SoundPlayer`/`ffplay` (Windows) — presence-probed (cached) and
SIGKILLed on abort so a second `/speak` or Ctrl+C stops playback. Read-aloud is
best-effort: a missing synthesizer (nudges to `moxxy plugins install tts-local`
/ `tts-openai`), TTS error, missing player, or non-zero exit all surface a
subtle notice and never block input — replies always render as text.
