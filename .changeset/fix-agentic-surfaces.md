---
"@moxxy/cli": patch
"@moxxy/desktop": patch
---

Fix the desktop agentic surfaces being undrivable: you couldn't type into the
terminal and the browser wouldn't navigate.

- **Surfaces were destroyed out from under their viewer (core).** A surface is
  shared (the agent's tool + the viewer drive one PTY/page), but `SurfaceHost`
  tore the instance down on the first `close`. React StrictMode (dev) makes that
  routine: it mounts → unmounts → remounts, so the first mount's late-resolving
  `open` fires a `close` that destroyed the instance the remount had just
  attached to. Output kept flowing (from the snapshot) so it looked alive, but
  `surface.input`/`surface.resize` then hit a missing instance and were silently
  dropped — no typing, no navigation, no resize, no error. Fixed with viewer
  ref-counting: the instance is only torn down when the last viewer detaches.
- **Terminal mounted at the wrong width (desktop).** The context rail animated
  its width open, so xterm's `fit()` measured a mid-slide sliver and the shell
  drew its prompt hard-wrapped narrow (which xterm won't reflow). The rail now
  snaps open so the pane is full-width at mount; the fit is rAF-debounced +
  width-guarded, and the terminal is focused on attach.
