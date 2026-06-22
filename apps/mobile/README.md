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
