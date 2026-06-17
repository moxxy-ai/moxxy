---
"@moxxy/cli": patch
"@moxxy/desktop": patch
---

Fix three bugs in the desktop agentic surfaces (terminal / browser / resizable rail):

- **Rail wasn't resizable.** The drag handle is absolutely positioned, but
  `.col-rail` had no `position`, so it anchored to a far ancestor and landed
  off-screen — the divider looked draggable but nothing grabbed it. Anchor the
  handle to the rail and keep it inside the clip box.
- **Terminal was shredded and unusable.** The rail animated its width open, so
  xterm's `fit()` measured a mid-slide sliver and pushed ~1–2 columns to the PTY;
  the shell then drew its prompt hard-wrapped to that width and it stayed stuck
  (xterm reflows its own soft-wraps, not shell-hard-wrapped output, so growing the
  pane back didn't unwrap it). Drop the rail's width animation so the pane is at
  full width the instant it mounts, guard + rAF-debounce the fit so the PTY's
  first resize is the real width, and focus the terminal on attach so typing works.
- **Browser was stuck on "Loading…".** The CDP `Page.startScreencast` push emits
  no frames for a blank/static/headless page and swallowed its own failure, so the
  pane spun forever. Stream the page by polling a JPEG `frame` (always yields a
  frame, works on any Playwright browser) and surface a real error/launch status
  instead of an indefinite spinner.
