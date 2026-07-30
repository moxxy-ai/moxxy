---
'@moxxy/design-tokens': minor
'@moxxy/desktop-ui': minor
'@moxxy/chat-model': minor
'@moxxy/desktop-host': patch
'@moxxy/desktop': minor
---

Redesign the desktop around one navigation rail, an instrument bar and a trace.

The app had its navigation split across two organs — a segmented pill in the
main-pane header and a list at the foot of the sidebar — so the same kind of
decision lived in two places and the header never said where you were. It now has
one 52px app rail, a contextual index column beside it, a field with an instrument
bar that identifies the run and carries its telemetry, and a tabbed workbench.

- **Tokens.** A new palette (achromatic panel greys, colour only on data, one
  accent that means "the human commanded this"), a mono chrome face with a
  proportional face for prose, and the scales the package never had: spacing,
  type, frame heights, motion. Gradients are gone.
- **Telemetry** (context window, token count, model, mode) moves out of chips
  inside the composer and into permanent chrome, where the numbers that make you
  intervene in an unattended run belong.
- **The transcript becomes a trace**: every entry hangs off one timeline in a
  fixed gutter, tool calls group into numbered steps with measured durations, and
  a blocking approval docks above the command bar instead of floating over the
  scroll.
- **Automations and Channels become destinations.** Workflows, schedules and
  webhooks left the Apps grab-bag; Mobile became one channel among the rest.

Also fixes, found while building it: the focus window's dark palette had drifted
in one of its three hand-maintained copies, so a system-dark user with no stored
theme preference got the light accent on a dark panel; and the renderer fetched
its webfonts from a CDN, which meant a cold offline boot rendered in a silent
fallback face. Both are gone, and with them the two CSP allowances the font CDN
needed.
