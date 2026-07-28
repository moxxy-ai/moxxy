# @moxxy/design-tokens

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
