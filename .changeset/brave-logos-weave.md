---
'@moxxy/desktop': minor
'@moxxy/plugin-cli': minor
---

New logo: two rounded squares woven through each other, replacing the pixel-art
mascot everywhere it was the brand mark.

The mark ships from `assets/brand/` (mark, wordmark, lockups, app icons, social
card, one-colour reduction, `build.sh` to regenerate every variant). On desktop
it is now inline SVG rather than a raster, so it inherits the surrounding text
colour and stays sharp at any size. Loading states turn it a quarter at a time,
which is a whole loop because the mark is symmetric under 90 degrees.

The TUI banner is redrawn as ASCII art of the same mark. The voice-call avatar
is deliberately untouched.
