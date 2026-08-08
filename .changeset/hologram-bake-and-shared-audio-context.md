---
'@moxxy/client-platform-web': patch
'@moxxy/desktop': patch
---

Stop Voice Mode burning a frame budget it does not have, and stop rebuilding the audio device between sentences.

The hologram repainted its ribbons, mesh, grain and bloom on every frame, which measured ~92ms per frame at 2400×820 — `shadowBlur` alone was ~45ms of it. The mark is a rigid body that only turns, so the invariant parts are now baked into offscreen sprites once per size and theme and composited with a rotation: ~9.7ms per painted frame, at half the frame rate. Dust colours come from a quantised table instead of a fresh string per mote per frame. The sprite cache is keyed on a quantised stage size and composited at the live one, so dragging the window resizes the mark by scaling rather than rebuilding four canvases per pixel of the drag; the backdrop, being two smooth gradients, is baked at quarter resolution to keep that cache small on wide displays.

Piper streams one sentence at a time and each clip built and closed its own `AudioContext`, so the audio device was torn down and reopened between every sentence. One context is now kept warm for the session and only the per-clip nodes are built and released.

Closing the context per clip had also been what released the clip's `<audio>` element; it is now released explicitly on every finish path, not only on `stop()`. A conversation that plays hundreds of sentences no longer leaves a decoded sentence per element waiting on the garbage collector.
