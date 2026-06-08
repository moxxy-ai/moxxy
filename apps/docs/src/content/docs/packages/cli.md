---
title: '@moxxy/cli'
description: The `moxxy` binary. Subcommand dispatcher, wires the full stack from moxxy.config.ts.
---

`@moxxy/cli` ships the `moxxy` binary. It's a thin app — most of the work is
`setupSessionWithConfig` (in `packages/cli/src/setup.ts`), which loads
`moxxy.config.ts`, registers built-in plugins, resolves `${vault:NAME}`
placeholders, and hands a fully-wired `Session` to the chosen channel.

## Subcommands

| Command | Behavior |
|---|---|
| `moxxy` | Opens the Ink TUI (default channel). |
| `moxxy tui` | Same, explicit. |
| `moxxy -p "..."` / `--prompt "..."` | Headless one-shot. Streams assistant text to stdout. |
| `moxxy -p "..." --output-format text\|json\|stream-json` | Scripting-friendly outputs. |
| `cat f \| moxxy -p "..."` | stdin piped as additional context. |
| `moxxy init` | Interactive first-time setup (provider keys → vault). |
| `moxxy login <provider>` | OAuth sign-in (e.g. `moxxy login openai-codex`). |
| `moxxy login status\|logout` | Inspect / remove stored OAuth creds. |
| `moxxy doctor [--check-keys]` | Diagnose config, vault, providers, channels, memory. |
| `moxxy resume [-s <id>\|<id>]` | Resume a persisted session (interactive picker if no id). |
| `moxxy channels [list]` | List registered channels + per-channel subcommands. |
| `moxxy channels <name> [<sub>]` | Run a channel, or invoke a channel subcommand. |
| `moxxy <channel>` | Shortcut for `moxxy channels <channel>`. |
| `moxxy sessions list\|delete [--empty]` | Manage persisted session logs. |
| `moxxy skills list\|new\|audit` | Manage skill files. |
| `moxxy plugins list\|install\|remove\|enable\|disable\|open\|reload\|new` | Install + manage plugins. |
| `moxxy perms list\|allow\|deny\|remove\|clear\|path` | View / edit the permission policy. |
| `moxxy memory list\|audit\|show\|revert\|prune-stale\|path` | Curate long-term memory. |
| `moxxy mcp list\|enable\|disable\|remove\|path` | Manage MCP server catalog (`~/.moxxy/mcp.json`). |
| `moxxy schedule list\|add\|remove\|run\|daemon\|setup` | Time-driven prompts (cron / one-shot). |
| `moxxy service list\|install\|uninstall\|start\|stop\|restart\|status\|logs\|path` | Install channels + scheduler as launchd / systemd --user units. |

The dispatcher is a single command map in `packages/cli/src/bin.ts`.
Anything not in the map and not a registered channel name falls through
to `unknown command`.

## Channel subcommands

`moxxy channels` introspects the registered `ChannelDef`s and runs any
subcommands declared on `ChannelDef.subcommands`. The CLI knows nothing
about specific channels — Telegram's `pair`, `unpair`, `status` live on
`packages/plugin-telegram/src/index.ts`.

```sh
moxxy channels telegram          # boot the Telegram bot
moxxy channels telegram pair     # bot-issued pairing wizard
moxxy channels telegram unpair   # forget the authorized chat
moxxy channels telegram status   # vault-token + pairing status (JSON)
moxxy channels http              # boot the HTTP channel
```

## Flags (top-level)

| Flag | Purpose |
|---|---|
| `--prompt`, `-p` | One-shot input (alias of the positional `prompt` form). |
| `--model <id>` | Override the default model for this invocation. |
| `--output-format <fmt>` | `text` / `json` / `stream-json` for one-shot runs. |
| `--allow-tools <list>` | Comma-separated tool allow-list (non-interactive runs). |
| `--allow-all` | Allow every tool without prompting. Use with care. |
| `--help`, `--version` | Help / version. |

## Env vars

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Default Anthropic provider key. |
| `OPENAI_API_KEY` | OpenAI provider key (and OpenAI embeddings). |
| `MOXXY_VAULT_PASSPHRASE` | Headless vault passphrase (alt to keychain). |
| `MOXXY_TELEGRAM_TOKEN` | Override the vault-stored Telegram bot token. |
| `MOXXY_HTTP_TOKEN` | Bearer token for the HTTP channel. |
| `MOXXY_FIXTURES` | `record \| replay \| passthrough` — provider fixture mode for tests. |
| `MOXXY_HOME` | Override `~/.moxxy` (config, vault, sessions, services, schedules, mcp). |

Run `moxxy <command> --help` for per-command details. Every help screen
goes through `formatHelp(...)` in `packages/cli/src/commands/help-format.ts`,
so the layout is consistent.
