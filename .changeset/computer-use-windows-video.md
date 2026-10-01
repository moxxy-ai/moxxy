---
'@moxxy/cli': minor
---

The Computer Use live view on Windows is now H.264 video, encoded with the system's Media Foundation encoder, when the viewer can decode it. A system without that encoder keeps sending JPEG frames, and the view shows them.
