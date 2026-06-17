---
"@moxxy/cli": patch
"@moxxy/desktop": patch
---

Fix three bugs in the desktop agentic surfaces (terminal / browser / resizable rail):

- **Rail wasn't resizable.** The drag handle is absolutely positioned, but
  `.col-rail` had no `position`, so it anchored to a far ancestor and landed
  off-screen — the divider looked draggable but nothing grabbed it. Anchor the
  handle to the rail, keep it inside the clip box, and drop the width transition
  mid-drag so the rail tracks the pointer 1:1.
- **Terminal was shredded and unusable.** xterm's `fit()` ran synchronously on
  mount while the rail was still sliding open (≈0 width), locking the terminal —
  and the PTY it resized — to ~1–2 columns, so every character wrapped. Fit only
  once the pane has real layout (deferred + `ResizeObserver`-driven, width-guarded),
  and focus the terminal once the surface is attached so typing works immediately.
- **Browser was stuck on "Loading…".** The CDP `Page.startScreencast` push emits
  no frames for a blank/static/headless page and swallowed its own failure, so the
  pane spun forever. Stream the page by polling a JPEG `frame` (always yields a
  frame, works on any Playwright browser) and surface a real error/launch status
  instead of an indefinite spinner.
