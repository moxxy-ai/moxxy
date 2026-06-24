# @moxxy/workspaces-app

## 0.2.3

### Patch Changes

- Updated dependencies [e4fe785]
  - @moxxy/sdk@0.18.0
  - @moxxy/chat-model@0.3.6
  - @moxxy/client-core@0.10.5
  - @moxxy/client-transport-ws@0.2.3

## 0.2.2

### Patch Changes

- 4fec599: Mobile: show a Stop button for the whole turn so a running agent/workflow can be cancelled.

  The composer's primary action only became Stop during the brief send round-trip
  (`sending`), so once the agent moved into a long thinking/tool/subagent run the
  button flipped back to Send and there was no way to cancel from the phone. It now
  follows the whole turn (`activeTurnId !== null || sending`) — matching desktop —
  and presses through to the existing `abort()` (which already cancels spawned
  subagents via the parent turn signal).

- Updated dependencies [0d6df6e]
  - @moxxy/sdk@0.17.0
  - @moxxy/chat-model@0.3.5
  - @moxxy/client-core@0.10.4
  - @moxxy/client-transport-ws@0.2.2

## 0.2.1

### Patch Changes

- 5e4d00f: Mobile: stop trapping the app behind connection loaders.

  The whole UI used to be gated behind the gateway transport — a paired phone that
  couldn't reach its Mac (the desktop gateway is on-demand and off by default) sat
  on a full-screen "Connecting to your Mac…" spinner with no way to reach settings
  or re-pair, because the drawer and Account lived inside the connected-only chat.

  Now the app shell always renders once a gateway is paired, connected or not:

  - Removed the blocking gateway loaders (`SplashScreen`, `ReconnectScreen`,
    `ConnectingView`). Launch shows a neutral backdrop only while storage is read.
  - Connection state is a single derived model (`buildConnectionState`) driving an
    inline status chip and, when the bridge is down, a non-blocking banner with
    Reconnect + Settings — never a screen that traps the user. Ordinary chat
    history still loads normally once the gateway is connected.
  - A Connection sheet (tap the header status, or "Settings" in the banner) and the
    always-available drawer → Account expose Reconnect / Re-pair / Disconnect plus
    guidance to enable the gateway on the Mac.
  - `usePairing` gains a non-destructive `reconnect()` and re-arms the bridge when
    the app returns to the foreground, so opening the app after enabling the Mac
    gateway just connects.

## 0.2.0

### Minor Changes

- 1461b08: Rebuild the mobile app's UI from scratch on a fresh design system, keeping the
  existing data/business hooks.

  - **New design system** (`src/ui/kit`): theme-aware Screen, headers, Card,
    Button, IconButton, ListRow, Pill, Segmented, EmptyState, and an iOS-26
    "Liquid Glass" material (`expo-blur`) used for the floating chrome.
  - **Theming**: a designed dark theme (default) plus light and system modes,
    selectable under Account → Appearance; every color resolves through a
    swappable palette.
  - **Drawer-centric navigation** (no bottom tab bar): the chat is the immersive
    home; the drawer holds collapsible workspace folders with their session
    history and a footer with Apps and Account. Apps (Workflows, Schedules) and
    Account are pushed screens.
  - **Onboarding**: a proper first-run pairing flow (QR scan + manual link) shown
    until the phone is paired to the desktop gateway.
  - **Composer**: a minimal glass single line that grows as you type — `+`
    (options bottom sheet), text, voice, send — with a drag grabber to
    minimize/restore.
  - Pairing copy now points to the desktop **Mobile** sidebar tab.

## 0.1.4

### Patch Changes

- 857b938: fix(mobile): build workspace deps on EAS before Metro bundles

  The app consumes `@moxxy/*` workspace packages from their built `dist/`, which is
  git-ignored and never produced on a fresh EAS checkout (EAS only runs
  `pnpm install`). Metro then failed to resolve `@moxxy/client-core` and friends.
  An `eas-build-post-install` hook now builds the app's transitive workspace dep
  closure after install and before bundling.

  Also pins the iOS `submit` target (`ascAppId` + `bundleIdentifier`) so
  `eas submit --non-interactive` resolves the App Store Connect app deterministically
  instead of running its auto app-creation path.

## 0.1.3

### Patch Changes

- 9d5eb74: Rebrand the mobile app to "workspaces". Rename the package
  `@moxxy/mobile-gateway-app` → `@moxxy/workspaces-app`, set the iOS bundle
  identifier to `ai.moxxy.workspaces` (app.json, the native Xcode project, and the
  matching bundle-id URL scheme in Info.plist — including the Live Activity
  extension), and set the Expo slug to `workspaces`.

## 0.1.2

### Patch Changes

- d9965f5: Fix mobile pairing over the proxy relay (`wss://…?fp=…`). The `@moxxy/e2e` Noise
  handshake draws its nonces and ephemeral keys from
  `globalThis.crypto.getRandomValues`, which Hermes (React Native) does not
  provide — so the encrypted handshake threw `crypto.getRandomValues must be
defined` before the socket ever opened, and pairing failed with a generic
  "couldn't connect to this gateway". Install a WebCrypto `getRandomValues`
  polyfill backed by `expo-crypto` as the first import in the app entry (works in
  Expo Go and native builds).

  Also narrow the Metro crawl: keep `watchFolders` at the repo root (so transitive
  `@moxxy/*` workspace deps still resolve) but add a `blockList` for `.git`, the
  multi-GB `.claude/worktrees`, and the other monorepo apps, so a cold start no
  longer traverses the whole workspace.

- d9965f5: Fix the mobile Metro `workspaceRoot` after the move to `apps/mobile`. It was
  `path.resolve(projectRoot, '../../..')`, correct for the old three-deep
  `apps/mobile-plugin/mobile` path but now resolving to the directory _above_ the
  repo. That gave Metro the wrong watch folder and `nodeModulesPaths`, so it
  resolved/served the workspace `@moxxy/*` packages incorrectly (e.g. a stale
  `@moxxy/client-transport-ws`). Now `../..` → the repo root.

## 0.1.1

### Patch Changes

- 648c966: Mobile app: pair through the self-hosted E2E proxy relay. The pairing flow now
  recovers the agent fingerprint from the QR (`?fp=`) and threads it into the
  transport (`makeWsApiHandle({ e2e: { pinnedFingerprint } })`), so a relay QR
  runs the encrypted handshake instead of failing as a plain `ws://` connection;
  LAN pairing is unchanged.

  Add EAS deployment for the Expo app: `eas.json` build/submit profiles, a dynamic
  `app.config.ts` that injects the Expo `owner` + EAS `projectId` from the
  environment (so the account identity is never committed), and a
  `Mobile EAS Build` GitHub Actions workflow driven by repo secrets
  (`EXPO_TOKEN`, `EXPO_OWNER`, `EAS_PROJECT_ID`).

  Remove the retired `apps/mobile-poc` proof-of-concept (superseded by
  `apps/mobile`).

- 648c966: Mobile app quality follow-ups:

  - Perf: throttle the live token stream (`useThrottledValue`, ~25fps) so the
    transcript rebuild + list reconciliation + auto-scroll run at a bounded rate
    instead of once per chunk; settle (empty) flushes immediately so the streaming
    row drops in lockstep with the committed message (no duplicate flash).
  - Security: scope cleartext to the LAN at the layer where it's actually
    enforceable — refuse a cleartext `ws://` pairing URL whose host isn't
    LAN/loopback/link-local/`.local` (a hostile QR can't point `ws://` at a public
    attacker and leak the bearer). Android's `usesCleartextTraffic` stays on (the
    OS can't scope cleartext to dynamic LAN IPs), but the app now gates it.
  - Security: mask the pairing code (the bearer token) shown in the manual
    ConnectionSettings panel.

- 648c966: Mobile app quality pass (perf, security, consistency):

  - Perf: the live streaming assistant row now renders as plain text and only
    parses markdown once the message settles — removing an O(n²) re-parse of the
    growing text on every chunk and the resulting pollution of the shared markdown
    block cache. Fix an untracked auto-clear timer in `useAttachments`.
  - Security: refuse a `wss://` (proxy-relay) pairing URL that lacks the E2E
    fingerprint (`?fp=`) instead of silently downgrading to a plaintext bearer;
    allow-list markdown link schemes (http/https/mailto) before `Linking.openURL`
    so an agent/relay-authored reply can't trigger out-of-app actions.
  - Consistency: remove the dead, never-wired token-in-URL transport stack
    (`useGatewaySocket`, `socketLifecycle`, `useGatewaySnapshot`, `pairingClient`,
    `PairingPanel`, `StreamingAssistant`, and the `applyGatewayFrame` reducer) and
    its tests; the live path runs through `@moxxy/client-core`.

- Updated dependencies [d5a3014]
- Updated dependencies [648c966]
  - @moxxy/client-transport-ws@0.2.1
  - @moxxy/sdk@0.16.1
  - @moxxy/chat-model@0.3.4
  - @moxxy/client-core@0.10.3
