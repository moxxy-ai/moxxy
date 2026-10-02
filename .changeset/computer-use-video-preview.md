---
'@moxxy/cli': minor
'@moxxy/desktop': minor
---

The live Computer Use view in the desktop chat is now real video on macOS. The helper encodes the app window as H.264 with the system encoder and the desktop decodes it with WebCodecs, so the view uses about thirty times less data than the JPEG frames it replaces and less CPU in the helper. A viewer that cannot decode video still gets JPEG frames, and so does everyone on Windows. When a viewer joins late or falls behind, it shows nothing new until the next key frame, which it asks for itself.
