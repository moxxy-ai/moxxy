---
'@moxxy/design-tokens': minor
'@moxxy/desktop': minor
'@moxxy/desktop-ui': patch
---

Move the commanded accent from magenta to the brand's Signal orange, so the app
accents on the same hue as the mark, the site and the rest of the branding
(`assets/brand/README.md`). Everything the accent touches follows: the send
action, the human's turn in the trace, the active rail item, focus rings, the
sidebar's active wash, filled buttons, the terminal cursor, and the second
strand of the mark on both pre-React splash screens.

On ink the accent is Signal exactly — `#FF4A1E` clears every contrast gate on a
dark ground. On paper it cannot be: `#FF4A1E` carries a white label at only
3.36:1 and sits at 2.78:1 against the panel ground, under the 4.5 and 3.0 floors
the palette is held to. Light therefore uses Signal's hue at full saturation,
deepened to the stop where white clears 4.5:1. That asymmetry is not new — it is
the rule the palette already documented for magenta, now carried over: the paper
accent is deep and white-labelled, the ink accent is luminous and ink-labelled.

The semantic hues are untouched. `green`, `amber`, `red` and `reference` still
mean nominal, attention, failure and reference data, and still carry their own
contrast floors.
