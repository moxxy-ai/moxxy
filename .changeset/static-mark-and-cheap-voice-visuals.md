---
'@moxxy/desktop': minor
---

Stand the Voice Mode mark still and make the voice visuals nearly free.

Measured in the running app over CDP rather than a harness: Voice Mode cost 19–40% of a 120Hz machine's CPU/GPU against 1.2% for the chat surface, and opening Focus Mode on top took it past 50%. The attribution was not what two days of optimising the hologram assumed — the animated canvas was ~10 points, four 2px bars in the control dock were another ~11, and the Focus spectrogram ~15.

The mark now stands in the same orientation as the app's own logo and is painted once, when the stage resizes or the theme changes. What moves with the voice is a single CSS custom property published fifteen times a second, driving a scale and an opacity — compositor properties, so they animate without a repaint and keep animating while the main thread is busy, which is what the old canvas loop could not do. The loop parks entirely once the level settles and no analyser is feeding it.

The dock bars' keyframes now declare both ends: a set with only a `to` leaves the start value to be inferred from computed style, and an animation with an implicit keyframe cannot be composited. The Focus spectrogram is paced to 30Hz and no longer draws a canvas shadow per bar, which was redundant against the blur the element already carries.

Voice Mode measured 3.0% after, with zero style recalculations in six seconds; Focus Mode 0.0%.
