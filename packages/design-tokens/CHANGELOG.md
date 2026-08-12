# @moxxy/design-tokens

## 0.5.0

### Minor Changes

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

## 0.4.0

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

## 0.3.0

### Minor Changes

- 5164d4b: Retune the desktop and mobile palette to the woven brand.

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

## 0.2.1

### Patch Changes

- 6546a06: Apply the "guard, don't chain" rule across the client-layer, IPC, and channel packages: replaced non-null assertions (`x!`) and depth-2+ optional chains with single-narrowing guard clauses (`assertDefined`/`invariant` from `@moxxy/sdk`, or local guards where `@moxxy/sdk` is not a dependency). Behavior is preserved — genuinely-optional single `?.` reads and silent absence paths are kept; only impossible-by-construction sites became loud throws. No runtime behavior change intended.

## 0.2.0

### Minor Changes

- d0e0bd2: Desktop workspaces now hold multiple sessions: desks persist a session list (v1 docs migrate so the first session keeps the desk's id and resumes its existing logs), the runner pool is keyed by session id (one `moxxy serve` per session), new `sessions.list/create/setActive/remove/rename` IPC commands (list/create/setActive/rename remote-allowed for mobile; remove host-only), and the sidebar shows the active desk's sessions with new/rename/delete affordances — `session.newSession` keeps its reset-current semantics. The desktop also gains dark mode (light/dark/system in Settings → Appearance, persisted in prefs, nativeTheme-synced, Clerk modals themed; designed `darkTokens` palette with CI-enforced light/dark parity), the workflow builder becomes a true infinite canvas (pan both axes unbounded, cursor-anchored zoom 10–400%, zoom-to-fit, persisted viewport), and self-update is honest about runner-protocol bumps: such releases report "requires full update" with a release-page link instead of staging a bundle the bootstrap would refuse and claiming success, update diagnostics explain boot-time refusals, and floor boots after a relaunch no longer inherit the previous override's identity.

## 0.1.0

### Minor Changes

- 85f9b91: Share the desktop client layer across platforms and expose the IPC over a WebSocket.

  The desktop renderer's hooks, state stores, chat model, and IPC client are now
  transport- and platform-agnostic so a future mobile app can reuse them:

  - **`@moxxy/client-core`** — the `use*` hooks + chat/connection/ask stores + chat
    model + the transport singleton + a platform-capability registry. DOM-free; the
    desktop renderer consumes it via thin `@/lib/*` shims (no behavior change).
  - **`@moxxy/client-platform-web`** — the Web implementations of those capabilities
    (mic capture/PCM16, Web Speech TTS, localStorage, window event bus).
  - **`@moxxy/design-tokens`** — framework-neutral tokens + a `:root` CSS generator.
  - **`@moxxy/client-transport-ws`** — a `MoxxyApi` over the global `WebSocket`
    (no Node deps), for remote clients.
  - **`@moxxy/ipc-server-ws`** — serves the same `IpcCommands`/`IpcEvents` contract
    over an authenticated WebSocket (loopback by default, bearer-token gated). The
    desktop's IPC handler registration is now transport-neutral (a `CommandBus`/
    `EventSink` seam + a shared `dispatch` core in `@moxxy/desktop-ipc-contract`), so the
    same handler bodies serve Electron IPC and the WebSocket; events fan out to both.
  - **`@moxxy/plugin-channel-mobile`** — a `mobile` channel that serves the bridge from
    the CLI backed by the runner's single session: `moxxy mobile` (and `moxxy serve --all`)
    expose it with no desktop needed. It can reach beyond the LAN via a cloudflared/ngrok
    tunnel (`channels.mobile.tunnel`) and prints a **QR code** (URL + token embedded) to
    pair. The desktop bridge stays opt-in via `MOXXY_WS_BRIDGE`.
  - **`@moxxy/sdk`** — adds `resolveChannelToken` + `bearerGuard`: the standard channel
    auth-token resolution (env → `channels.<name>.token` → a persisted secret) and a
    pre-connection bearer handler, so channels gate connections uniformly. The mobile
    bridge + WS server adopt them.

  A new `apps/mobile` Expo proof-of-concept drives the chat loop (and permission prompts)
  through the shared hooks over the WebSocket bridge — against either backend. First launch
  shows a QR scanner that pairs by scanning `moxxy mobile`'s code. Desktop behavior is
  unchanged.
