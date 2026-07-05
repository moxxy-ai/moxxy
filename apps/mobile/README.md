# Moxxy Mobile (Expo)

The Expo app that pairs with a moxxy runner (desktop "Start mobile" or the
`moxxy mobile` CLI channel) over an authenticated WebSocket. When the gateway is
exposed through the self-hosted **proxy relay**, the QR carries the agent's
public-key fingerprint (`?fp=`); the app pins it and runs the `@moxxy/e2e`
handshake inside the tunnel, so the bearer token is end-to-end encrypted and the
relay only ever sees ciphertext. On the same Wi-Fi it falls back to a plain LAN
`ws://` connection.

## Local development

```sh
pnpm install            # from the repo root
cd apps/mobile
pnpm start              # expo start  (no Expo account needed)
```

## Deploying with EAS (your Expo account)

The Expo **account identity is not committed** — it is injected from the
environment by `app.config.ts`, so nothing about your account lives in the repo:

| Variable         | What it is                                              |
| ---------------- | ------------------------------------------------------- |
| `EXPO_TOKEN`     | Expo access token (the real secret) — used by eas-cli   |
| `EXPO_OWNER`     | Your Expo account/org username (the project owner)      |
| `EAS_PROJECT_ID` | The EAS project UUID (`eas project:info`)               |

### One-time setup

1. Create an Expo access token: Expo dashboard → **Account → Access tokens**.
2. In the GitHub repo, add three **Actions secrets**: `EXPO_TOKEN`,
   `EXPO_OWNER`, `EAS_PROJECT_ID`.
3. (Local builds only) copy `.env.example` → `.env` and fill in `EXPO_OWNER` +
   `EAS_PROJECT_ID`. `.env` is gitignored.

### Build from CI

Run the **Mobile EAS Build** workflow from the Actions tab
(`.github/workflows/mobile-eas-build.yml`) — choose the platform, profile
(`preview` / `production` / `development`), and whether to submit to the stores.

### Build locally

```sh
cd apps/mobile
export EXPO_TOKEN=...           # or `eas login`
eas build --profile preview --platform all
```

Build profiles live in `eas.json`. If `EAS_PROJECT_ID` is unset, `eas` falls
back to interactive `eas init` to link/create a project under your account.

## Over-the-air updates (EAS Update)

The whole JS/TypeScript bundle and its assets can be shipped **over-the-air** with
[EAS Update](https://docs.expo.dev/eas-update/introduction/) — no App Store /
Play Store review, updates land the next time the app is opened. This covers
everything that isn't native: React components, screens, business logic, images,
copy, styling, bug fixes.

**What OTA cannot ship:** native code / native modules, new permissions, the app
icon or splash, or an Expo SDK bump. Those change the **runtime version** and
require a fresh `eas build` + store release. See _Runtime versions_ below.

### How it's wired

| Piece | Where |
| ----- | ----- |
| `expo-updates` config (`updates.url`, `runtimeVersion`) | `app.json` + derived URL in `app.config.ts` |
| Update channels per build profile (`preview`, `production`) | `eas.json` → `build.*.channel` |
| Native enable flags (iOS is committed) | `ios/.../Supporting/Expo.plist` |
| In-app "check → download → apply on next open" | `src/otaUpdates.ts` + `useOtaUpdates` + `<OtaUpdateController/>` (mounted in `app/_layout.tsx`) |
| Manual publish CI job | `.github/workflows/mobile-eas-update.yml` |

The `<OtaUpdateController/>` mounted at the root checks for an update on launch
and on every return to the foreground, downloads it silently, and applies it the
next time the app becomes active — so a fresh bundle boots in without interrupting
whoever is using the app. All the decision logic is the pure `reduceOta` state
machine in `src/otaUpdates.ts`; the flow is dormant in Expo Go, in dev, and on
web. To add a visible "update ready" banner later, read `useOtaUpdates()`.

### Publish an update from CI

Run the **Mobile EAS Update (OTA)** workflow from the Actions tab
(`.github/workflows/mobile-eas-update.yml`) — pick the **channel** (`preview` /
`production`), platform, and a message. It builds the workspace deps, typechecks
and tests the app (OTA skips store review, so this gate is on by default —
`skip_checks` bypasses it for emergencies), then runs `eas update`. The update is
published to the EAS branch of the same name as the channel, so a build made with
that channel picks it up.

> First-time setup: run **Mobile EAS Build** once per channel (e.g. a
> `production` build) so EAS creates the channel and links it to its branch.
> After that, OTA publishes flow to installed builds on that channel.

### Publish an update locally

```sh
cd apps/mobile
pnpm --filter "@moxxy/workspaces-app^..." run build   # build workspace deps first
export EXPO_TOKEN=...                                  # or `eas login`
eas update --branch preview --message "Fix chat scroll"
```

### Runtime versions

`runtimeVersion` uses the `appVersion` policy, so the runtime version is the app
`version` in `app.json` (currently `1.0.0`). An OTA update only reaches builds
whose runtime version matches. **Bump `version` whenever you ship a native change**
(new native module, permission, SDK bump) and cut a new `eas build` — this starts
a fresh runtime line so old builds don't receive a bundle that needs native code
they don't have. For iOS, the committed `Expo.plist`'s `EXUpdatesRuntimeVersion`
must match; re-run `expo prebuild -p ios` (or edit it) when you bump the version.
