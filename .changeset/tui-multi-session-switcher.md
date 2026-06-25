---
"@moxxy/plugin-cli": minor
"@moxxy/cli": patch
---

TUI: multi-session switcher (`/sessions`).

- New `/sessions` slash command (alias `/switch`) opens a `ListPicker` overlay
  listing your saved conversations — first-prompt title, last-active time, event
  count and active model — sourced from the same `~/.moxxy/sessions` index the
  desktop sidebar and `moxxy resume` already read. The session you're in is
  marked, and a leading **+ New session** entry starts a fresh conversation.
- Picking an entry re-points the TUI onto that session in place: the live session
  is torn down (firing its `onShutdown` hooks and releasing the runner socket),
  the chosen session is booted (resuming its persisted history, or a fresh one),
  and the chat view re-mounts onto it. Your previous conversation stays saved, so
  you can switch back and forth.
- Works when the TUI hosts the session (the default self-host / `--standalone`
  modes). When attached to an external `moxxy serve` (whose runner owns a single
  fixed session) the switcher degrades to a notice pointing at `moxxy resume`.
