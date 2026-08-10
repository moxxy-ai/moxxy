---
'@moxxy/desktop': patch
---

Draw the Voice Mode hologram from the token palette alone. It had been warming the accent toward a redder pink, tinting the ink strand blue and sinking the field to a near-black of its own — three hues that exist nowhere in `@moxxy/design-tokens`. The Harness language gives each hue exactly one meaning and says plainly that nothing may borrow the accent, so the accent strand is now `--color-primary` untouched, the ink strand is `--color-text`, and the field is the palette's own deepest ink. Fallback values are read from the token module rather than retyped, and a test fails if a raw colour literal reappears in the hologram source.
