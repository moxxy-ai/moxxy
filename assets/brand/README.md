# moxxy brand

## The mark

A ribbon of brushed metal, lined in glowing orange, wraps a dark visor with two
lit eyes. It reads as a face that is listening: an agent that is present and
ready. The ribbon closes into a speech bubble's tail at the lower right, so it
also reads as a conversation.

The mark is a rendered picture, not a vector. `moxxy-mark-master.png` (1254 px,
on a black ground) is the one source; every other file is cut out of it by
`build.py`.

## Palette

| Token | Hex | Use |
|---|---|---|
| Ink | `#0B0D12` | Text, dark backgrounds |
| Signal | `#FF4A1E` | Accents, focus states. The eyes and the ribbon's lining glow in this family. |
| Paper | `#FFFFFF` | Ink's inverse on dark |

Signal is deliberately warm. Developer AI tooling is saturated with blue and
violet, and orange holds contrast on both a white page and a dark terminal.

## Files

| File | Use |
|---|---|
| `moxxy-mark-master.png` | The source picture. Replace this to change the mark, then rebuild. |
| `png/moxxy-mark-<n>.png` | The mark cut out of its ground (RGBA), 16 to 1024 px. Default everywhere: the desktop's `MoxxyMark` and pre-React splashes (`apps/desktop/public/moxxy-mark.png`), the mobile app (`apps/mobile/assets/moxxy-mark.png`), READMEs. |
| `png/moxxy-icon-<n>.png` | App icon: the master on a rounded tile, on the macOS 824/1024 grid. Desktop window, Dock, installers, favicon and the Windows / Linux tray (`apps/desktop/public/logo.png`). |
| `png/moxxy-icon-square-1024.png` | App icon for iOS and Expo: full bleed, square, **no alpha channel**. iOS masks the corners itself and rejects an icon that carries alpha; `apps/mobile/test/iosPlist.test.ts` reads the IHDR colour type to enforce it. |
| `png/moxxy-mark-template-22.png`, `-44` | macOS menu bar: the mark's silhouette in one ink with the eyes cut out, shipped as `apps/desktop/public/trayTemplate.png` + `trayTemplate@2x.png`. AppKit tints a template image for the light and dark bar and reads only its alpha, so the shape alone has to carry the face. |
| `png/moxxy-mark-template-blink-22.png`, `-44` | The same menu-bar glyph with the eyes closed to slits: the blink frame, shipped as `trayBlinkTemplate.png` + `@2x`. The name has to end in `Template` for AppKit to tint it and pair it with its @2x. |
| `png/moxxy-mark-eyeless-<n>.png` | The cut-out mark with its eyes and their glow painted over in the visor's dark glass. `BlinkingMoxxyMark` lays drawn eyes on it (`apps/desktop/public/moxxy-mark-eyeless.png`, sharp up to 128 px). |
| `png/moxxy-mark-eyes.json` | Where the eyes sit, as shares of the mark's side, so the drawn eyes land exactly on the painted-out ones (`apps/desktop/src/components/moxxy-mark-eyes.json`). |
| `alternates/` | Earlier directions. `alternates/weave/` holds the retired woven-squares mark with its wordmark, lockups and social card. |

The terminal art in `packages/plugin-cli/src/logo-data.ts` is built from the
same master: the ribbon sampled to a character ramp, the visor blank and the two
eyes solid.

**Not yet redrawn for this mark:** a wordmark, the lockups and the social card.
Their previous versions are in `alternates/weave/`.

## Animation

Loading states let the mark breathe: it eases down to 92% scale and 70% opacity
and back over 2.4 s. The mark is a face, not a symmetric figure, so it never
turns. `.moxxy-avatar-loader` in `apps/desktop/src/styles.css`, the pre-React
splashes in `apps/desktop/index.html` and `focus.html`, and `MoxxyMarkSpinner`
in `apps/mobile` all run the same breath; the desktop ones stop under
`prefers-reduced-motion`.

### Blinking

The mark blinks in two places. In the desktop sidebar's masthead
(`BlinkingMoxxyMark`) the eyes are drawn over the eyeless picture and squash to
10% of their height for about a tenth of a second: twice every seven seconds,
the second time doubled, by the `.moxxy-mark-blink__eye` animation in
`styles.css`. In the macOS menu bar (`electron/main/tray-blink.ts`) the tray
swaps to the closed-eyes template for 140 ms, every four to eight seconds. Both
hold still when the system asks for reduced motion.

## Rules

- **Clear space**: 4% of the mark's longer side on every side. `build.py`
  bakes it into every `moxxy-mark-<n>.png`.
- **Minimum size**: 16 px for the mark. Below that, or on chrome you do not
  control, use the app icon, whose tile carries the shape.
- **Do not** recolour the mark, flatten it to one colour outside the menu-bar
  template, crop the speech-bubble tail, or place it on a busy photo (use the
  icon).

## Rebuilding

```sh
./assets/brand/build.sh
```

It runs `build.py` (stdlib Python, about 30 s) to regenerate `png/`, then copies
the shipped files into `apps/desktop/public/`, `apps/mobile/assets/` and the iOS
asset catalog. Paste the terminal art it prints into
`packages/plugin-cli/src/logo-data.ts`. `apps/desktop/electron/main/brand-assets.test.ts`
and `apps/mobile/test/mobile-brand-assets.test.ts` fail when a shipped copy
drifts from `png/`.
