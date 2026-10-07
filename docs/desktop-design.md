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
| Sidebar | 280 px wide, resizable between 220 and 400 px. It collapses with ⌘B / Ctrl+B. |
| Sidebar row | 54 px high: a 36 px avatar, the name with the time beside it, and a one-line preview. A small badge on the avatar shows the state (working, unread). |
| Header | 40 px, no bottom line: the avatar and name on the left, the model and one menu on the right. Search, focus mode and rename sit in that menu. The run's state shows only when it needs attention. |
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
the stylesheet.

## The shell

The window is a sidebar, the conversation, and a work panel. There is no rail.

The sidebar lists the runs in one section per workspace. A run row shows what
the session list knows (name, time of last activity) and what this window knows
(the newest message and whether a turn is running, for conversations it has
open). The session list does not carry a last message, so a run that has not
been opened in this window shows its first prompt if it was renamed, or its
model otherwise.

Every other place is reached two ways, and both read one list,
`apps/desktop/src/shell/navigation/destinations.ts`:

| Way in | Where |
|---|---|
| Account menu | The row at the foot of the sidebar. It lists every place, the command palette and the keyboard shortcuts. |
| Command palette | ⌘K / Ctrl+K, from any view. It lists the same places and the current run's actions. |

In any view other than the runs, the sidebar's head carries a back control. A
place that needs a loaded session (Collaborate, Automations, Apps) is shown
disabled, with the reason, while the session loads.

Menus are one component, `shell/menu/PopoverMenu.tsx`, positioned by
`shell/menu/usePopover.ts`. A menu opened with the pointer grows from the
control that opened it. A menu opened from the keyboard appears at once.

## The conversation

A run reads as a messenger conversation, on a 760 px measure centred in the
pane.

| Entry | How it is drawn |
|---|---|
| What the person said | A bubble on the right, filled with the action colour. A prompt over 12 lines opens clamped, with a control that says how many lines it holds. Attachments sit above the bubble. |
| What the agent said | A bubble on the left, in its own neutral tone. Code, tables and quotes inside it are tinted against the bubble. |
| Tool calls, reasoning, sub-agents | Quiet lines down the left, no wider than a bubble. The ones with a body open in place. |
| Triggers, stops, errors | A note with a short label. |

Under a message sit its time and, for an answer, copy, read aloud and feedback.
That line always takes its height and is shown for the message under the
pointer or holding focus, so revealing it moves nothing. On a touch screen it
is always shown.

`chat/trace/TraceEntry.tsx` maps an entry's kind to its side and owns the row.
The bubble is drawn by the block inside it (`UserBlock`, `AssistantBlock`).

The composer is one card on the same measure: a round add button, the field, a
dictation button, and a round button that sends. While a turn runs the send
button is Stop, and the field says a new message will queue. Attach, actions,
goal, auto-approve, voice conversation and mode are in the add menu. The
composer says what the next turn will do only when it is not the default:
auto-approve on, or a goal waiting for its objective. The mode and the model
are read in the header.

`apps/desktop/src/styles.conversation.test.ts` holds the drawing rules that can
be checked in the stylesheet.

## The work panel

The terminal, the file browser, the diff and the browser share one panel on the
right. Closed, it draws nothing and takes no room. The run's header has the
button that shows and hides it, and ⌘J / Ctrl+J does the same; both call one
toggle (`shell/useWorkbench.ts`), which reopens the pane that was last in use.
The panel still opens by itself the first time the agent drives its browser or
terminal.

Its width is never animated: the terminal measures its columns when it mounts.
The closed panel stays in the layout at zero width instead of being removed,
because the browser parked inside it has to keep painting to keep its pages.

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
2. **Shell** (done): the rail is gone, the sidebar is a run list, the account
   menu and the palette lead everywhere else, and the header is lower.
   `PRODUCT.md` changed in the same step, because it names the desktop's
   primary navigation.
3. **Conversation** (done): bubbles, quiet work lines and the one-card
   composer.
4. **Right panel** (done): the work panel is gone while closed and opens from
   the run's header.
5. **Other views**: Settings, Extensions, Automations, Apps, Channels, Mobile and
   onboarding, then the focus window.
