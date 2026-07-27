# Configuration reference

Moxxy can load a `moxxy.config.ts` file from the project root. The CLI setup flows create and update configuration for common cases.

## Example

```ts
import { defineConfig } from '@moxxy/config';

export default defineConfig({
  plugins: {
    provider: {
      default: 'anthropic',
      items: {
        anthropic: {
          model: 'claude-sonnet-4-6',
          config: { apiKey: '${vault:ANTHROPIC_API_KEY}' },
        },
      },
    },
    mode: {
      default: 'default',
    },
    packages: {
      '@moxxy/plugin-browser': { enabled: false },
    },
  },
});
```

`${vault:NAME}` placeholders are resolved when a session starts. The vault unlocks through the OS keychain by default and supports a passphrase fallback. Headless environments can provide that passphrase with `MOXXY_VAULT_PASSPHRASE`.

Do not commit plaintext credentials. See [SECURITY.md](../SECURITY.md) for the security model and hardening guidance.

## Environment variables

Provider keys such as `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` are detected automatically. Moxxy-specific variables are listed below.

### Runtime and storage

| Variable | Effect |
|---|---|
| `MOXXY_HOME` | Overrides the `~/.moxxy` directory used for the vault, skills, sessions, and services. |
| `MOXXY_DEBUG=1` | Enables verbose CLI errors and process diagnostics. |
| `MOXXY_VAULT_PASSPHRASE` | Supplies a headless vault passphrase instead of using the OS keychain. |
| `MOXXY_SESSION_ID` | Resumes a specific persisted session when running `moxxy serve`. |
| `MOXXY_RUNNER_SOCKET` | Overrides the runner's Unix socket path. |
| `MOXXY_RUNNER_STRICT_ABORT=1` | Denies cross-client turn aborts instead of allowing and audit-logging them. |
| `MOXXY_NO_CORE_UPDATE=1` | Disables registration of Tier 2 core self-update tools. |
| `MOXXY_FIXTURES` | Selects `record`, `replay`, or `passthrough` provider fixture mode for tests. |

### Network egress

Node's global `fetch` ignores proxy variables on its own, and every provider call goes through it. Moxxy installs a proxy dispatcher at startup so these take effect.

| Variable | Effect |
|---|---|
| `https_proxy` / `HTTPS_PROXY` | Proxy for `https:` origins, which is every provider API. Lowercase wins if both are set. |
| `http_proxy` / `HTTP_PROXY` | Proxy for `http:` origins. Deliberately not used as a fallback for `https:`. |
| `no_proxy` / `NO_PROXY` | Comma or whitespace separated bypass rules. `*` bypasses everything; `.corp.example` covers the domain and its subdomains; `host:8081` restricts the rule to that port. |
| `NODE_EXTRA_CA_CERTS` | Path to an extra CA bundle. Required when the proxy terminates TLS, otherwise requests fail with `UNABLE_TO_VERIFY_LEAF_SIGNATURE`. Node reads it at startup, so it must be set in the environment, not in config. |

Run `moxxy doctor` to see which proxy is in force and whether an extra CA is configured. Proxy credentials are masked in all output.

Config can override the environment, which is what a managed workstation wants:

```yaml
network:
  # 'env' (default) reads the variables above; 'off' forces direct;
  # a URL pins that proxy even if the user clears their shell profile.
  proxy: http://proxy.corp.example:3128
  # Merged with no_proxy from the environment, never replacing it.
  noProxy: .corp.example,localhost
```

### Channels

| Variable | Effect |
|---|---|
| `MOXXY_TELEGRAM_TOKEN` | Overrides the vault-stored Telegram bot token. |
| `MOXXY_HTTP_TOKEN` | Sets the bearer token for the HTTP channel. |
| `MOXXY_WEB_TOKEN` | Sets the authentication token for the web surface. |
| `MOXXY_NO_WEB_SURFACE=1` | Prevents `moxxy serve` from starting the web surface. |
| `MOXXY_MOBILE_TOKEN` | Sets the bearer token for the mobile WebSocket bridge. |
| `MOXXY_MOBILE_HOST` | Sets the mobile channel bind host. The default is `127.0.0.1`; `0.0.0.0` exposes it to the LAN. |
| `MOXXY_MOBILE_TUNNEL` | Selects `localhost` (no tunnel) or `proxy` (the self-hosted encrypted relay) for the mobile channel tunnel. |
| `MOXXY_VOICE_AUDIO_DEVICE` | Selects the audio capture device for TUI voice input. |
| `MOXXY_MCP_STDERR=inherit` | Surfaces MCP server stderr. It is ignored by default. |

### Desktop and bridge

| Variable | Effect |
|---|---|
| `MOXXY_WS_BRIDGE=1` | Enables the desktop WebSocket IPC bridge for remote clients. |
| `MOXXY_WS_PORT` | Overrides the desktop bridge port. |
| `MOXXY_WS_HOST` | Overrides the desktop bridge bind host. |
| `MOXXY_WS_TOKEN` | Sets the desktop bridge authentication token. A token is generated when omitted. |
| `MOXXY_WS_ALLOW_QUERY_TOKEN=1` | Accepts the legacy `?t=` query token. Native clients use a protocol bearer and this option is off by default. |
| `MOXXY_CLI_ENTRY` | Sets the CLI entry that the desktop app uses to spawn runners. |
| `MOXXY_CHATS_DIR` | Overrides the desktop NDJSON chat-log directory. The default is `~/.moxxy/chats`. |
| `MOXXY_UPDATE_URL` | Overrides the desktop self-update manifest URL. |
| `MOXXY_UPDATE_SIGNING_KEY` | Supplies the private desktop bundle signing key in CI only. |
| `MOXXY_APP_BUNDLE_ROOT` | Internal desktop bootstrap value. Do not set it manually. |
| `MOXXY_APP_BUNDLE_VERSION` | Internal desktop bootstrap value. Do not set it manually. |

## Related guides

- [Getting started](getting-started.md)
- [Features and channels](features.md)
- [Developer guide](developer-guide.md)
- [Security and hardening](../SECURITY.md)
