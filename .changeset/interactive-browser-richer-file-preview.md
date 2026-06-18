---
"@moxxy/plugin-browser": patch
"@moxxy/desktop-host": patch
"@moxxy/desktop-ipc-contract": patch
"@moxxy/desktop": patch
---

feat(surfaces): interactive in-window browser + richer file preview

**Browser — a genuinely interactive, full-bleed view.** The live view now behaves
like a real browser: click / double-click, hover (`:hover` styles + tooltips via
pointer move), scroll, full keyboard incl. modifier shortcuts, and
back/forward/reload — with a snappier refresh that bursts a fresh frame after each
interaction. The page viewport is resized to the pane (`surface.resize` →
`setviewport`) so the view fills the whole container instead of being letterboxed,
and clicks map 1:1. The install/loading states are on-brand (spinner, primary
Button, indeterminate progress bar, condensed progress line) instead of dumping
raw npm output.

**Files — preview opens far more types.** Images and PDFs render inline (PDF via
Chromium's viewer in a `blob:` iframe — `frame-src blob:` added to the CSP);
text/code open directly; binary-looking or very large files prompt before opening
as text (a huge blob in a `<pre>` can crash the renderer). `workspace.readFile`
gained a discriminated result (`kind: text | image | pdf | confirm` plus
`mediaType` / `base64` / `reason` / `byteLength`) and a `force` flag, and reads
only a head window via a file handle so a multi-GB file never loads whole.
