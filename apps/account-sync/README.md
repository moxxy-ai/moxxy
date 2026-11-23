# Desktop account sync

A signed-in person can open **Account → Device sync** to save their keys and preferences, restore them on another computer, or remove the account copy. Saving merges individual fields. For matching fields the last save wins. Restore replaces matching local values. Local vault entries remain available to the OS user after signing out. Reopen the desktop to refresh cached preferences and model readiness.

## Run the service

Use Node 22.19 or later. From the repository root run:

```sh
pnpm install --frozen-lockfile
pnpm --filter @moxxy/desktop-ipc-contract... build
node --env-file=/path/to/server.env apps/account-sync/server.mjs
```

Set these variables **on the service**:

- `CLERK_SECRET_KEY` is the Backend API key for the desktop's Clerk instance.
- `CLERK_ISSUER` is its exact Frontend API origin, such as `https://clerk.example.com`.
- `DESKTOP_ORIGINS` is a comma-separated list of exact authorized parties. For packaged Moxxy use `https://desktop.moxxy.ai:51789,https://desktop.moxxy.ai:51790,https://desktop.moxxy.ai:51791,https://desktop.moxxy.ai:51792`. Use the actual Vite origin in a separate development instance.
- `PORT` defaults to 4781. The service listens on IPv4 loopback. Put an HTTPS reverse proxy on the same host, forward only `/v1/device-sync`, rate-limit requests and disable caching and request/response body and authorization-header logging.

Set `VITE_ACCOUNT_SYNC_URL=https://your-sync-host.example/v1/device-sync` and the matching `VITE_CLERK_PUBLISHABLE_KEY` before building the desktop. For the GitHub release workflow set repository variable `VITE_ACCOUNT_SYNC_URL` alongside the existing publishable-key secret. For local development the desktop accepts `http://127.0.0.1:4781/v1/device-sync`. Builds with no endpoint omit the sync controls.

## Pre-provision an account

In Clerk Dashboard, open the test or production user and edit their **private metadata**. Merge this field into the existing object:

```json
{
  "moxxyDesktopV1": {
    "keys": { "OPENAI_API_KEY": "example-only" },
    "prefs": { "theme": "system", "voiceEngine": "local", "replySound": true }
  }
}
```

Supported key names are `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `GOOGLE_API_KEY`, `ELEVENLABS_API_KEY`, `DEEPSEEK_API_KEY`, `Z_AI_API_KEY`, `ZAI_API_KEY` and `TYPESAFE_API_KEY`. Preferences also support `systemNotifications` and `inAppToasts`. All fields inside `keys` and `prefs` are optional. Keep the snapshot within 7,000 UTF-8 bytes and leave room for other metadata within Clerk's 8 KB limit.

Clerk administrators and the sync backend can read these values. Keep this namespace out of public/unsafe metadata, logs and session-token templates. Only the desktop host exchanges key values with the service. The renderer receives a key count. The service verifies the signed token, issuer, authorized party and live session ownership, and uses its authenticated subject for the metadata path.
