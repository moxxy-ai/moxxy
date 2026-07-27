---
'@moxxy/desktop': patch
---

Retone the desktop palette away from the candy brand, and pin contrast in CI.

The palette led with hot pink (`#ec4899`) for every CTA, send button and focus ring, bright cyan for the accent, and pink gradients. That reads as a consumer toy in a room where the app is being evaluated for a fleet. Primary becomes a deep muted blue, the accent a desaturated teal, decorative purple and pink fold into the same family, and the status hues are toned down without losing their meaning.

Dark mode no longer inherits the accents. The light primary is chosen to carry white text on a near-white surface, and that same ink is close to invisible on a near-black canvas, so each accent now has an explicit dark counterpart lifted into the readable range.

A palette change is otherwise unverifiable by CI: nothing fails when colours become unreadable. New tests compute WCAG contrast for the pairings that matter in both themes, which caught a pre-existing defect: dim text sat at 2.56:1 on white, below the 3:1 large-text floor. It is darkened to 3.36:1.

Colours are still declared in two places (the desktop stylesheet is the source of truth, design-tokens mirrors it) and the existing parity test keeps them honest.
