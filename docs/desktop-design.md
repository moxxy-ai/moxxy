# Desktop design: the messenger look

The desktop app is being redrawn as a messenger. The conversation is the main
thing on screen. Everything else is reachable but out of the way.

This document is the contract for that redesign. It covers the desktop app
only; the mobile app, the TUI and the web channel keep their own look.

## Decisions

| Question | Decision |
|---|---|
| Themes | Light and dark, both designed. The Appearance setting keeps working. |
| Accent | The brand's Signal orange. It is the only accent. |
| Chrome colour | Neutral greys with no hue. |
| Typeface | Each platform's own text face (SF Pro, Segoe UI). No bundled webfont. |
| Geometry | Rounded: 4 / 6 / 8 / 12 px, plus rounder bubbles and sheets. |
| Sidebar row | A session. Workspaces are collapsible section headers above their sessions. |
| Other destinations | One account menu at the foot of the sidebar, and the ⌘K / Ctrl+K palette. |

## Layout target

| Area | Target |
|---|---|
| Sidebar | 280 px wide, resizable between 128 and 400 px, with a compact form. |
| Sidebar row | 54 px high: a 36 px avatar, the name with the time beside it, and a one-line preview of the last message. A small badge on the avatar shows the state (working, unread, waiting for you). |
| Header | 38 px, no bottom line: the avatar and name on the left, a few icons on the right. Telemetry, run state, search and focus mode sit behind one control. |
| Transcript | Bubbles. The user's are on the right in a contrasting fill, the agent's on the left in the surface fill. Tool activity stays as quiet markers between them. |
| Composer | One rounded card, 48 px when empty: a round add button, the field, and a round voice or send button. |
| Right panel | Closed by default. Files, terminal, browser and diff open in it from a header icon. |
| Motion | 120 to 240 ms, ease-out. A pressed control scales to 0.97. |

## Motion rules

Motion follows Emil Kowalski's design-engineering rules. They apply to every
step of the redesign.

| Rule | In practice |
|---|---|
| Decide whether it should animate at all | Nothing triggered from the keyboard animates: the ⌘K palette, shortcuts and list navigation appear at once. Menus, sheets and panels animate. |
| Use the curves, not the keywords | `--ease-out` for entrances and presses, `--ease-in-out` for things that move across the screen, `--ease-drawer` for panels that slide. Colour and hover changes keep `ease`. Nothing eases in. |
| Stay fast | State changes take `--motion-shift` (160 ms), a press `--motion-press` (120 ms), an overlay `--motion-overlay` (240 ms). No interface animation runs longer than 300 ms. |
| Answer a press | Every pressable control scales to 0.97 while pressed. |
| Enter from somewhere | An entrance starts at `scale(0.96)` with zero opacity, never from `scale(0)`, and never overshoots. A menu grows from its trigger; a modal stays centred. |
| Animate what is cheap | Only `transform` and `opacity` move. Widths, heights and margins do not animate. |
| Leave faster than you arrive | An exit is shorter than its entrance. |
| Hover is for pointers | Hover effects sit behind `@media (hover: hover) and (pointer: fine)`. |
| Respect reduced motion | Movement is removed; opacity and colour changes stay. |

`apps/desktop/src/styles.motion.test.ts` holds the rules that can be checked in
the stylesheet. The sidebar and rail still animate their width; that goes away
when the shell is rebuilt in step 2.

## Where the values live

The desktop has its own palette pair, `desktopTokens` and `desktopDarkTokens`,
in `packages/design-tokens/src/desktop.ts`. The shared `tokens` and `darkTokens`
in the same package are what the mobile app reads, and the redesign does not
change them.

Both desktop palettes keep the shared token shape, so every CSS variable the
renderer already reads keeps resolving. `apps/desktop/src/styles.css` declares
those variables, and a parity test in the design-tokens package fails when the
stylesheet and the palette disagree. The same package tests colour contrast for
every palette against WCAG 2.1.

## Reference and licence

The target look was measured from OpenBot, which is published under the
PolyForm Noncommercial licence. Moxxy is MIT. No OpenBot code, stylesheet,
avatar or logo is copied into this repository. The layout and the measurements
above are reimplemented here in Moxxy's own components.

## Steps

1. **Foundation** (done): palette, typeface, radii, type scale and motion.
2. **Shell**: remove the app rail, rebuild the sidebar as a session list, add the
   account menu and the palette entries, and shrink the header. `PRODUCT.md`
   changes in the same step, because it names the desktop's primary navigation.
3. **Conversation**: bubbles and the compact composer.
4. **Right panel**: the workbench closed by default, opened from the header.
5. **Other views**: Settings, Extensions, Automations, Apps, Channels, Mobile and
   onboarding, then the focus window.
