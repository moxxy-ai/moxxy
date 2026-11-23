# Desktop account sync

When a signed-in person saves a supported API key in setup or Settings, Moxxy saves that individual key to their encrypted local vault and their Clerk private metadata. Replacing or deleting a key updates the corresponding account entry. Sign-in alone never uploads an existing vault. A signed-out person can keep entering keys locally.

**Automatically save API keys to my account** is on by default. Turn it off in the key form or **Account → Device sync** to remove all saved account keys and keep future entries local across devices. Turning it back on syncs future edits. Existing local keys and account preferences are preserved. The service enforces the account setting even for clients with an older cached preference.

On a new computer, sign in and select **Account → Device sync → Restore here**. This replaces matching local values. **Save to account** is still available for an explicit backup of existing keys and preferences. Reopen the desktop to apply restored preferences. Keys in the local vault remain accessible to the OS user after sign-out.

## Why a service

Clerk's Frontend API can sign a person in. Reading or writing their private metadata requires the Backend API. The service keeps the instance secret on the server and uses the verified session to select the user's record. The current client is the desktop. A future TUI client can share this endpoint once it obtains a supported Clerk session token and the service verifies its client origin. [Clerk metadata permissions](https://clerk.com/docs/guides/users/extending)

## Deploy on Coolify

1. Point a DNS record for your chosen hostname (for example, `sync.example.com`) at the Coolify proxy. Allow inbound HTTP and HTTPS for certificate issuance and routing.
2. In the Coolify project, add an application from the Git repository `https://github.com/moxxy-ai/moxxy`. Select a branch containing this Dockerfile. Use `development` after the PR merges. Select the **Dockerfile** build pack, set **Base Directory** to `/` and **Dockerfile Location** to `/apps/account-sync/Dockerfile`. The shared schema and lockfile are built from the repository root. [Coolify Dockerfile settings](https://coolify.io/docs/applications/builds/dockerfile)
3. Set **Ports Exposes** to `4781`. Add the hostname with HTTPS and target container port `4781`. Leave the domain path and host port mapping empty. Coolify terminates TLS on port 443. Run one replica so overlapping account writes and opt-outs are ordered. The image listens on `0.0.0.0:4781`, runs as the `node` user and supplies its own health check. Clerk stores the account data, so the service needs no volume or database. [Coolify domain routing](https://coolify.io/docs/core/networking/domains)
4. Under **Environment Variables**, set the following production runtime values. Disable build-time availability for the secret. Use the same production Clerk instance that issued the desktop's publishable key. [Coolify environment variables](https://coolify.io/docs/applications/configuration/environment-variables)

   | Variable | Value |
   | --- | --- |
   | `CLERK_SECRET_KEY` | The instance's Backend API secret (`sk_live_…`) |
   | `CLERK_ISSUER` | The exact session token issuer, e.g. `https://clerk.example.com`, without a trailing slash |
   | `DESKTOP_ORIGINS` | `https://desktop.moxxy.ai:51789,https://desktop.moxxy.ai:51790,https://desktop.moxxy.ai:51791,https://desktop.moxxy.ai:51792` |

5. Deploy. From outside Coolify, run the following with your hostname. The first request should return HTTP 200 and `{"status":"ok"}`. The second should return HTTP 401 because it has no session token. These checks establish routing and authentication enforcement. An authenticated save and restore also exercises the Clerk configuration.

   ```sh
   curl -i https://sync.example.com/healthz
   curl -i https://sync.example.com/v1/device-sync
   ```

6. In the GitHub repository under **Settings → Secrets and variables → Actions → Variables**, set `VITE_ACCOUNT_SYNC_URL=https://sync.example.com/v1/device-sync` using your hostname. Keep the matching `CLERK_PUBLISHABLE_KEY` under **Secrets**. Build the next desktop release after setting the URL. Sign in, enter a fixture key in **Settings → Vault**, then choose **Restore here** in a second device profile signed into the same account. Turn off automatic key saving, enter a replacement and verify that the account copy stays empty.

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
- `PORT` defaults to 4781. `HOST` defaults to `127.0.0.1` for a native process. Put an HTTPS reverse proxy in front of the service and route `/v1/device-sync` and `/healthz`. Rate-limit sync requests and disable caching and request/response body and authorization-header logging.

Set `VITE_ACCOUNT_SYNC_URL=https://your-sync-host.example/v1/device-sync` and the matching `VITE_CLERK_PUBLISHABLE_KEY` before building the desktop. For the GitHub release workflow set repository variable `VITE_ACCOUNT_SYNC_URL` alongside the existing publishable-key secret. For local development the desktop accepts `http://127.0.0.1:4781/v1/device-sync`. Builds with no endpoint omit the sync controls.

## Data stored in Clerk

Moxxy writes the signed-in user's supported API keys under `private_metadata.moxxyDesktopV1.keys` and portable preferences under `private_metadata.moxxyDesktopV1.prefs`. The account-wide opt-out is a boolean in `public_metadata.moxxyAutoKeySyncDisabled`. Users manage it from Moxxy through the authenticated service.

Supported key names are `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `GOOGLE_API_KEY`, `ELEVENLABS_API_KEY`, `DEEPSEEK_API_KEY`, `Z_AI_API_KEY`, `ZAI_API_KEY` and `TYPESAFE_API_KEY`. Preferences also support `systemNotifications` and `inAppToasts`. All fields inside `keys` and `prefs` are optional. Keep the snapshot within 7,000 UTF-8 bytes and leave room for other metadata within Clerk's 8 KB limit.

Clerk administrators and the sync backend can read these values. Keep this namespace out of public/unsafe metadata, logs and session-token templates. Only the desktop host exchanges key values with the service. The renderer receives a key count. The service verifies the signed token, issuer, authorized party and live session ownership, and uses its authenticated subject for the metadata path.
