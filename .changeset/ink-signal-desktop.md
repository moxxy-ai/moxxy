---
'@moxxy/desktop': minor
'@moxxy/design-tokens': minor
---

Retune the desktop and mobile palette to the woven brand.

The muted blue the palette landed on carries nothing of the mark: the brand is
Ink (`#0B0D12`) plus Signal (`#FF4A1E`) on paper, so every accent in the app
read cool around a warm mark.

`@moxxy/design-tokens` is the source of truth for the desktop CSS variables and
the mobile Tailwind config, so the change lands in one place and reaches every
component that reads a variable. Signal becomes the primary, send and focus
colour; the secondary moves into Signal's family; the canvas goes neutral so
nothing fights Signal's warmth; and the text ramp becomes Ink.

Interactive fills take Signal's DEEP stop (`#C4310F`), not the flat mark
colour: white on flat Signal is 3.36:1, and a CTA label is the one place that
cannot be borderline. Flat Signal lives on as the mark, the focus ring and the
soft washes. On dark it lifts again, to `#FF6A44`, for the same reason the mark
ships a `-dark` variant rather than being recoloured by CSS. The contrast suite
covers both themes.

Categorical and semantic hues are deliberately left alone. A workflow step kind
is identified by its hue and green/amber/red mean success/attention/error, so
collapsing them into the brand's single accent would destroy information. Only
the fallback moves to Signal.

Headings now take Space Grotesk, echoing the wordmark's geometric
construction. It joins the Google Fonts request Inter already makes, and the
stack falls back to Inter, so an offline launch looks exactly as it does today.

Also swept: the standalone focus window carried a second copy of the palette,
and a handful of components had the old hexes inline, including the pink glows
and plan badges the previous retone left behind. The voice spectrogram keeps
its blue-violet-pink ramp: that is a data gradient, not a brand accent.
