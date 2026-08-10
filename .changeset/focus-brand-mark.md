---
'@moxxy/desktop': patch
---

Draw Focus Mode with the same in-app Moxxy mark the rest of the window uses. The floating widget rendered a raster mascot, the mini-text header scaled down the packaged app icon, and the pre-mount boot tile rendered a typed `m` glyph in a colour outside the palette. All three now render `MoxxyMark`, so the floating widget and the main window cannot drift apart. The app icon at `public/logo.png` is unchanged and stays the product's icon.
