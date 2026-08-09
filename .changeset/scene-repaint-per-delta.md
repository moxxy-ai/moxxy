---
'@moxxy/desktop': patch
---

Stop the Voice Mode scene repainting on every streaming delta. Its `occupiedSlots` prop arrives as a freshly mapped array on each render of the voice surface, and the paint effect depended on the array itself — so every delta of a streaming turn rebuilt the 2,600-particle field and repainted the canvas, shadow bloom included. The effect now keys on the slots' content and reads the array through a ref.
