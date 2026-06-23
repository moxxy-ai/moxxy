---
'@moxxy/workspaces-app': minor
---

Redesign the mobile app around an iOS-26 "liquid glass" visual language, built
on a new additive design layer in `styles/tokens.ts` (motion grammar, elevation
ramp, glass material variants, brand gradient ramps, AA-safe ink) and a small set
of dependency-free primitives: an SVG `Gradient` (real brand gradients via the
already-present `react-native-svg`), a frosted `GlassSurface`/`GlassSheet` shell,
and motion helpers (`PressableScale` spring-press, `Appear` entrances, `PulseDot`
live status) that all honor the OS "Reduce Motion" setting.

Every surface was reworked for depth, consistency and life: the chat header,
composer (gradient send), message stream, thinking indicator, navigation drawer,
top bar, connection banner, waiting room, and all chat sheets/overlays (asks,
permissions, pickers, goal, compact, session actions, rename) plus the session,
workflow, scheduler and settings lists. Scattered hardcoded hex and inconsistent
radii/shadows were unified onto the tokens, and the off-brand dead `ComposerBar`
was removed.

New: a first-run animated onboarding carousel (parallax slides, crossfading
gradient backgrounds, pill pagination) shown once and persisted, with a launch
gate that routes returning users straight to chat.

QR pairing now scans live the moment the scanner opens — the manual "arm" tap is
gone (the one-shot scan gate still prevents double-pairing), with an animated
scan frame and clearer live status.
