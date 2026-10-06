---
'@moxxy/cli': minor
'@moxxy/desktop': minor
---

Desktop browser: work on what the accessibility tree cannot name. `browser_capture` without a uid returns a named viewport picture in CSS pixels, and the new `browser_point` clicks, drags, scrolls, presses keys and types at places in it — refused when the page navigated, scrolled or changed at that place since the picture, and answering with a fresh one. The new `browser_upload` gives a page's file field local files (asking every time), including the hidden input behind an "Add attachment" button.
