---
"@moxxy/desktop": patch
---

fix(desktop): header nav collapsed even on wide windows; remove white-background brand GIF

- **Header nav stuck collapsed.** The responsive `Segmented` collapse (shipped in
  0.12.0) folded the nav groups into dropdowns even on wide screens. Once
  collapsed, the live pill row unmounted, so the fit-measurer lost the natural
  width and the container shrink-wrapped the small collapsed button — `available`
  looked tiny and it could never tell it would fit again, so any transient narrow
  moment (window opening, a resize) wedged it collapsed forever. Fixed by keeping
  the inline row ALWAYS mounted as a hidden measuring layer at its natural width
  inside a shrinkable, clipping box: the fit check now reads the true natural vs.
  available width whether or not it's collapsed, so it collapses only when the row
  genuinely doesn't fit and re-expands the instant room returns.
- **Removed the white-background brand GIF** (`new-animation.gif`) — its white
  matte can't be keyed out on the dark theme. Every use now points at the existing
  transparent static `logo.png`; the CSS bob animation is preserved.
