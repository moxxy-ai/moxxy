# What leaves the machine

Every outbound request moxxy makes, what triggers it, and what it carries. Written for the review that asks "where does our data go", and answered at the level of "which host, on what trigger", not "we take privacy seriously".

## There is no telemetry

moxxy sends no usage analytics, no crash reports, and no product metrics. There is no opt-out because there is nothing to opt out of. Every request below is either something you asked for or the version check named in the first table, and each is listed with the host it reaches.

## Unattended: happens without you asking

| Host | Trigger | Carries | Turn it off |
|---|---|---|---|
| `registry.npmjs.org` | Starting the TUI | The installed CLI version, to compare against the published one. No identifiers, no usage data. Fire-and-forget; the result only warms a cache for the next start. | Skipped automatically for workspace/dev installs. Otherwise block the host, or run a surface other than the TUI. |

That is the complete list. Nothing else contacts anything until you give the agent work to do.

## On a turn: the model provider

| Host | Trigger | Carries |
|---|---|---|
| Your provider's API (`api.anthropic.com`, `api.openai.com`, an OpenAI-compatible endpoint you configured, …) | Running a turn | The conversation as the loop projects it: your prompts, the system prompt, tool definitions, and tool results. |

This is the largest and most important flow, and it is the one nobody can remove: it is what an LLM agent *is*.

What it carries in practice:

- **Tool results are content.** A `Read` result is the file. A `Bash` result is the command's output. If the agent reads a secret, that secret is in the request.
- **`${vault:KEY}` placeholders are not.** They resolve at the boundary where they are used, so the plaintext never enters the model's context, the transcript, or the event log.
- **Compaction and elision change what is sent, not where.** They reduce the projected history; they do not add a destination.

Choosing a provider is a data-processing decision. A self-hosted or OpenAI-compatible internal endpoint keeps this flow inside your network; see `plugins.provider` in [configuration](configuration.md).

## On explicit action

| Host | Trigger | Carries |
|---|---|---|
| `raw.githubusercontent.com/moxxy-ai/registry` (or your `plugins.registryUrl`) | `moxxy plugins install` / `search`, and the TUI plugin picker | The request only. Response is signature-verified before use. |
| `registry.npmjs.org` | `moxxy plugins install` / `search` | The package spec being installed or the search query. |
| `api.github.com` | Installing from a GitHub spec | The repository reference. |
| Your OAuth provider | `moxxy login <provider>` | A standard OAuth 2.0 / PKCE or device-code exchange. |
| `proxy.moxxy.ai`, or your own relay | Only when a tunnel provider is active (mobile pairing, the web surface) | Encrypted channel traffic. Not used unless you start a channel that needs a tunnel. |
| Whatever a tool reaches | The agent calling `web_fetch`, `browser_*`, an MCP server, or a channel you started | Whatever that tool sends. Gated by the permission engine, and by the egress allow-list if configured. |

## What stays on the machine

| Data | Location | Mode |
|---|---|---|
| Conversation transcripts | `~/.moxxy/sessions/<id>.jsonl` | `0600`, dir `0700` |
| Session metadata | `~/.moxxy/sessions/<id>.json` | `0600` |
| Secrets | `~/.moxxy/vault.json` (AES-256-GCM) | `0600` |
| Vault master key | OS keychain, or `~/.moxxy/vault.key` | `0600` |
| Permission policy | `~/.moxxy/permissions.json` | `0600` |
| Audit trail | `~/.moxxy/audit/<date>.jsonl` | `0600`, dir `0700` |
| Long-term memory, skills, plugins | under `~/.moxxy/` | `~/.moxxy` is `0700` |

None of these are transmitted anywhere by moxxy. An audit **sink** other than the local floor is the deliberate exception: configuring one is how you send records off the machine on purpose.

## Controlling egress

Everything above is subject to the network settings:

```yaml
network:
  # Pin a proxy the user cannot route around by clearing their shell profile.
  proxy: http://proxy.corp.example:3128
  noProxy: .corp.example,localhost
```

Set `NODE_EXTRA_CA_CERTS` in the environment when the proxy terminates TLS. Node reads it at startup, so it cannot be configured here. `moxxy doctor` reports the effective proxy with credentials masked.

To keep plugin installation inside your network, pin `plugins.registryUrl` at an internal mirror and set `plugins.installPolicy: registry-only`. To forbid runtime installation entirely, use `denied` and provision through the config manifest with `moxxy sync`.

## Auditing this yourself

Do not take this document's word for it. `moxxy doctor` reports the effective network posture, and with `security.enabled: true` every tool declares the hosts it intends to reach, which `moxxy security audit` lists. For the definitive answer on a specific machine, watch the process: these are ordinary HTTPS requests and appear in any proxy log.
