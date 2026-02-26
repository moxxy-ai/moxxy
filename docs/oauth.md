# OAuth for Skills

Some skills (e.g. `google_workspace`) require OAuth credentials to access external APIs. Use the `moxxy oauth` command to obtain and store these credentials in the agent's encrypted vault.

## Commands

```bash
# List skills with OAuth support
moxxy oauth list

# Run OAuth flow for a skill
moxxy oauth <skill_name> [options]
```

## Flow Overview

1. **Agent selection** - Choose which agent's vault stores the credentials (default: `default`)
2. **Client ID & Secret** - From your OAuth provider's developer console
3. **Authorization** - Authorize the app in your browser, then paste the code
4. **Storage** - Credentials are encrypted and stored in the vault

The authorization URL is **always shown in the terminal**, even when the browser opens automatically. This gives you a fallback if the browser fails to open or you prefer to copy the link manually.

## Local Use (Interactive)

For a local machine with a display:

```bash
# Interactive: URL shown, you open browser manually
moxxy oauth google_workspace

# Interactive: Opens browser automatically, URL also shown as fallback
moxxy oauth google_workspace --open-browser
```

With `--open-browser` (or `-b`), moxxy opens the authorization URL in your default browser. The URL stays visible in the terminal in case something goes wrong.

## Server / Headless Use

When moxxy runs on a server (e.g. SSH session, CI, remote VM), use `--code` to pass the authorization code non-interactively:

```bash
moxxy oauth google_workspace \
  --agent default \
  --client-id YOUR_CLIENT_ID \
  --client-secret YOUR_CLIENT_SECRET \
  --code AUTH_CODE_FROM_OAUTH_PAGE
```

Obtain the auth code by opening the OAuth URL on another machine, authorizing, and copying the code from the redirect or result page.

## Options

| Option | Description |
|--------|--------------|
| `--agent`, `-a <name>` | Target agent (default: `default`) |
| `--client-id <id>` | OAuth client ID (skips prompt if provided) |
| `--client-secret <secret>` | OAuth client secret (skips prompt if provided) |
| `--open-browser`, `-b` | Open auth URL in default browser (local only) |
| `--code <auth_code>` | Auth code for server/headless (non-interactive) |
| `--help`, `-h` | Show help |

## Example: Google Workspace

1. Create OAuth credentials in [Google Cloud Console](https://console.cloud.google.com/) (APIs & Services → Credentials → OAuth client ID → Desktop app)
2. Run the flow:

   ```bash
   moxxy oauth google_workspace --open-browser
   ```

3. Authorize in the browser, paste the code when prompted
4. Credentials are stored as `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` in the vault
