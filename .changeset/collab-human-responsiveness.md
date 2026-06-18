---
"@moxxy/mode-collaborative": patch
---

fix(collaborative): agents reply to the human instead of going silent

Stepping into a running collaboration felt one-way: a human directive or direct
message reached a live agent (via the awareness nudge), but agents only ever
broadcast progress to the team — they never addressed the human back, so it
looked like "the team doesn't respond". The shared prompt now tells every agent
to treat a human directive/message as authoritative AND reply to them with
`collab_send` to "human" — acknowledge it and say what they'll do (or ask a brief
clarifying question). Adds prompt-content regression tests (brief pointer +
memory recall/save + the human-reply rule + cross-functional roster guidance).
