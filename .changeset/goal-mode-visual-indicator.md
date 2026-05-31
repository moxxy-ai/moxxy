---
"@moxxy/sdk": minor
"@moxxy/cli": minor
---

Make an active mode visually obvious while it's running.

Modes can now advertise a presentation `badge` (`ModeDef.badge`), surfaced on
`SessionInfo.activeModeBadge` so every channel sees it over the wire. Goal mode
declares one, so activating it now shows a persistent indicator the user can't
miss — even mid-loop, when the usual mode footer is replaced by the "Thinking"
marker:

- **TUI** — a reverse-video `GOAL` pill stays pinned to the status line for the
  whole run, alongside the busy spinner.
- **Desktop** — a persistent accent banner above the composer plus an accented
  Mode chip, both lit/cleared the moment the mode switches.
