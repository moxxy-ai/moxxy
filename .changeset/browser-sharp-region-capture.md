---
"@moxxy/plugin-browser": patch
"@moxxy/desktop": patch
---

fix(surfaces): sharper, smoother in-window browser + region-capture-to-chat

**Sharpness.** The live view was blurry on HiDPI/Retina displays — it streamed a
1× JPEG (quality 55) that the browser then upscaled into a 2× pane. The Playwright
context now renders at `deviceScaleFactor: 2` and frames use JPEG quality 70, so
text is crisp.

**Less lag.** The poll interval dropped 450ms → 300ms (the `inFlight` guard still
prevents pile-up), on top of the existing burst-frame-after-each-interaction.

**Region capture → chat input (replaces element-pick).** The toolbar's selector
button is now "Capture a region": drag a box over any part of the page and a sharp
PNG of exactly that area is attached to the chat composer (with a "📎 added to the
chat input" confirmation). You then describe the change and send — the agent SEES
the pixels. This is more robust and usable than the old CSS-selector pick: it works
for any content, not just DOM elements, and rides the normal attach→send flow. New
sidecar `capture` method (clipped screenshot).
