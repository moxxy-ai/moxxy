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
          model: 'claude-sonnet-5',
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

`${vault:NAME}` placeholders are resolved when a session starts, through the **active secret provider** with the local vault as fallback, which is the same path `ctx.getSecret(name)` takes inside a tool. A placeholder therefore means the same thing in config as it does anywhere else. The vault unlocks through the OS keychain by default and supports a passphrase fallback. Headless environments can provide that passphrase with `MOXXY_VAULT_PASSPHRASE`.

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

## Scopes and precedence

Configuration is merged from four layers, highest authority first:

| Scope | Location | Notes |
|---|---|---|
| system | `/etc/moxxy/config.yaml`, `%PROGRAMDATA%\moxxy\config.yaml`, or `$MOXXY_SYSTEM_CONFIG` | Operator-managed. YAML only, and the only layer that can lock keys. |
| user | `~/.moxxy/config.yaml` | |
| project | `moxxy.config.yaml` (or `.ts`) found by walking up from the working directory | |
| explicit | `--config <path>` | |

The system layer is YAML only on purpose: an executable file there would run as whoever starts moxxy, so a misconfigured `/etc/moxxy` would become a privilege-escalation path.

### Installing a baseline

`moxxy profile enterprise` prints a system-scope config with the security controls already locked. It only prints: the file it belongs in is root-owned and carries site-specific entries (proxy URL, audit sink) that have no safe default, so an operator reviews it before placing it.

```sh
moxxy profile list
moxxy profile enterprise                              # review
moxxy profile enterprise | sudo tee /etc/moxxy/config.yaml
moxxy doctor                                          # confirm what took effect
```

### Keeping a fleet on the same plugin set

`plugins.packages` is the install ledger. Commit it with a project, or push it from the system scope, and `moxxy sync` converges a machine on it.

```sh
moxxy sync            # install what the manifest declares and is missing
moxxy sync --check    # report drift, exit 1, change nothing
```

`--check` exits non-zero only for *missing* packages, so it works as a provisioning gate in CI. Sync never removes anything: a package a user installed themselves is reported as extra, and removing it is their call.

### Locking settings a user must not change

A system config can pin dot-paths. Every listed path is stripped from the user, project, and explicit layers before merging, and the attempt is reported on stderr.

```yaml
# /etc/moxxy/config.yaml
security:
  enabled: true
network:
  proxy: http://proxy.corp.example:3128
locked:
  - security.enabled
  - network.proxy
```

Locking a parent (`network`) pins the whole subtree, not just the leaves already present.

### Executable project configs

`moxxy.config.ts` (and `.js`/`.mjs`/`.cjs`) is code, executed with your full privileges before the permission engine, the vault, or any isolator exists. Because the search walks up from the working directory, entering a cloned repository used to run its config silently.

Moxxy now asks before running one, and remembers the approval against the file's **content**, so editing it asks again:

```sh
moxxy config trust                 # approve ./moxxy.config.ts
moxxy config trust path/to/cfg.ts  # approve a specific file
moxxy config trust --list          # what has been approved
moxxy config untrust <file>        # withdraw approval
```

A non-interactive run has nobody to ask, so it skips the file rather than executing unreviewed code. Pre-approve with `moxxy config trust` when provisioning a daemon or a container image. To forbid executable configs entirely on a managed host:

```yaml
# /etc/moxxy/config.yaml
config:
  allowExecutable: false
```

YAML configs are data and are never gated.

### Permission rules an operator can push

`permissions.allow` / `permissions.deny` in config are applied as an **immutable layer above** `~/.moxxy/permissions.json`. They are checked first, never written back, and cannot be removed by editing that file, by answering "allow always", or by deleting it. Put them in the system scope with `permissions` in `locked:` and they become policy a user cannot get rid of.

```yaml
permissions:
  deny:
    # Anchored and path-aware: covers /etc and everything under it.
    - name: Read
      inputPathPrefix: { path: /etc }
      reason: managed policy
    - name: Read
      inputGlob: { path: "**/.ssh/**" }
  allow:
    - name: Read
      inputPathPrefix: { path: /srv/app }
```

Three matchers, and the choice matters:

| Matcher | Semantics |
|---|---|
| `inputPathPrefix` | anchored, path-segment aware. `/srv/app` covers `/srv/app/x` but not `/srv/apple`, and `..` is normalised away first. |
| `inputGlob` | anchored whole-value. `*` stays within a path segment, `**` crosses, `?` is one character. |
| `inputMatches` | **unanchored** regex, the long-standing policy-file contract. |

Prefer the first two when writing an organisation's policy. `{ Read: { path: '/etc' } }` as `inputMatches` reads like "under /etc" but means "contains /etc anywhere", which over-blocks as a deny and over-grants as an allow.

Decision order: managed deny, then file deny, then managed allow, then file allow.

### Secret vault

Keys are encrypted at rest. Where the master key lives is resolved in order: `MOXXY_VAULT_PASSPHRASE`, the OS keychain, a cached key at `~/.moxxy/vault.key` (mode `0600`), and finally a **randomly generated** key that is persisted for next time.

You are never asked to invent a passphrase. That used to be the last resort, which made first run a hard stop on any host without an OS keychain: a container, a headless Linux box, CI. A generated key gives the same protection against what this vault is actually for, which is a key leaking through config committed to git, a transcript, or a log. It does not protect against someone who can already read a `0600` file in your home directory. An OS keychain, or a passphrase, does raise that bar.

```yaml
vault:
  # Demand a human-chosen passphrase instead of generating a key.
  requirePassphrase: true
```

`moxxy doctor` reports which source is in use.

### Audit trail

Distinct from the event log. The event log is the conversation: complete, replayable, local. The audit trail is the receipt: bounded, redacted, hash-chained, and safe to forward off the machine.

```yaml
audit:
  enabled: true          # off by default; a trail nobody asked for is a liability
  sink: local            # the hash-chained floor; plugins can register others
  includePromptText: false  # default: record only a prompt's length + SHA-256
  retentionDays: 400
```

Records land in `~/.moxxy/audit/<YYYY-MM-DD>.jsonl`, owner-only. Each commits to the previous record's hash, so removing or editing one breaks every hash after it.

```sh
moxxy security audit-log               # verify every day's chain
moxxy security audit-log 2026-07-27    # verify one day
```

Exit code 1 on a broken chain, so a scheduled check can gate on it.

Chaining makes the trail tamper-**evident**, not tamper-proof: whoever can write the file can recompute the whole chain. It catches silent, selective deletion, which is the realistic threat. Genuine tamper-proofing needs the chain head somewhere the machine cannot rewrite, which is what a remote sink provides.

Prompt text is not recorded by default. The SHA-256 always is, so a specific prompt can still be proven to be the audited one without the trail itself disclosing it. Tool inputs are recorded redacted, alongside a hash of the unredacted input.

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
- [Deploying in an organisation](deployment.md)
- [Threat model](threat-model.md)
- [What leaves the machine](data-flow.md)
- [Security and hardening](../SECURITY.md)
