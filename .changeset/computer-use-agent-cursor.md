---
'@moxxy/sdk': minor
'@moxxy/cli': patch
---

Computer Use: the control snapshot can now carry the agent cursor (its phase — idle, moving, executing, delivered or failed — and its place as a fraction of the target window) and the target the human sees (app and window title). The cursor disappears from the snapshot once Computer Use is stopped or its helper has failed. On macOS, observing an app shows Moxxy's own pointer in a click-through overlay ordered just above that app's window, kept out of screen sharing; the real mouse pointer does not move. The pointer glides along a short arc (it jumps under Reduce Motion), can mark a press and frame the element it is about to use. A window on another Space gets no overlay, but its cursor position is still reported.
