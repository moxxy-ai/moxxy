# @moxxy/desktop-ui

## 0.3.1

### Patch Changes

- 9757ae4: Move the commanded accent from magenta to the brand's Signal orange, so the app
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

## 0.3.0

### Minor Changes

- c49ab14: Redesign the desktop around one navigation rail, an instrument bar and a trace.

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

## 0.2.0

### Minor Changes

- 34cca59: Chat: a user turn now reads left-to-right like every other block, with an
  avatar, a "You" label and an accent left rule instead of right-aligned text.
  Right alignment only said whose turn it was while the turn was short: a pasted
  prompt wrapped into a ragged-left column the eye had to re-find on every line.

  Tray: the macOS menu bar gets the one-colour mark as a template image at 22px
  and @2x, so AppKit tints it for the light and dark bar and for the menu-open
  state. Windows and Linux keep the colour icon, since their tray chrome is not
  ours to tint against.

## 0.1.1

### Patch Changes

- 062955f: Promote the mobile gateway to its own sidebar entry (above Settings) and make it on-demand only.

  - Move the mobile pairing surface out of Settings into a dedicated top-level **Mobile** view in the sidebar.
  - The gateway no longer auto-starts with the app — it stays off on every launch and is enabled explicitly per session (the persisted pairing token/identity are kept, so re-enabling reuses the same QR).
  - Tear the gateway down through its manager on quit so the end-to-end proxy tunnel is closed and the relay deregisters this machine — fixing the "unresponsive until you regenerate the code" pairing left behind by a leaked tunnel from the previous run.

## 0.1.0

### Minor Changes

- 358a565: Sidebar polish: workspace rows now carry a single color-tinted folder icon (replacing the grid glyph), row actions ([+] new session, ⋯ menu) are hover-only and overlay the right edge of the name with a gradient fade instead of reserving width — so workspace and session names use the full row when idle — and the sidebar widened 232px → 272px for readable first-prompt titles. desktop-ui gains a `folder` icon.

## 0.0.3

### Patch Changes

- d0e0bd2: Desktop workspaces now hold multiple sessions: desks persist a session list (v1 docs migrate so the first session keeps the desk's id and resumes its existing logs), the runner pool is keyed by session id (one `moxxy serve` per session), new `sessions.list/create/setActive/remove/rename` IPC commands (list/create/setActive/rename remote-allowed for mobile; remove host-only), and the sidebar shows the active desk's sessions with new/rename/delete affordances — `session.newSession` keeps its reset-current semantics. The desktop also gains dark mode (light/dark/system in Settings → Appearance, persisted in prefs, nativeTheme-synced, Clerk modals themed; designed `darkTokens` palette with CI-enforced light/dark parity), the workflow builder becomes a true infinite canvas (pan both axes unbounded, cursor-anchored zoom 10–400%, zoom-to-fit, persisted viewport), and self-update is honest about runner-protocol bumps: such releases report "requires full update" with a release-page link instead of staging a bundle the bootstrap would refuse and claiming success, update diagnostics explain boot-time refusals, and floor boots after a relaunch no longer inherit the previous override's identity.
