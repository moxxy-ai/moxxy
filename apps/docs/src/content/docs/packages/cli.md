---
title: '@moxxy/cli'
description: The `moxxy` binary. Subcommand dispatcher, wires the full stack from moxxy.config.ts.
---

`@moxxy/cli` ships the `moxxy` binary. It's a thin app — most of the work is `setupSessionWithConfig` (in `src/setup.ts`), which loads `moxxy.config.ts`, registers built-in plugins, resolves `${vault:NAME}` placeholders, and hands a fully-wired `Session` to the chosen channel.

## Subcommands

| Invocation | Behavior |
|---|---|
| `moxxy` | Opens the Ink TUI (default). |
| `moxxy tui` | Same, explicit. |
| `moxxy -p "..."` / `--prompt "..."` | Headless one-shot. Streams assistant text to stdout. |
| `cat f \| moxxy -p "..."` | stdin piped as additional context. |
| `moxxy -p "..." --output-format text\|json\|stream-json` | Scripting-friendly outputs. |
| `moxxy telegram` | Start the Telegram bot (must be paired). |
| `moxxy telegram pair` | Generate a pairing code, start the bot. |
| `moxxy telegram unpair` | Forget the authorized chat. |
| `moxxy telegram status` | Token + pairing status. |
| `moxxy skills list\|new <name>` | Manage skill files. |
| `moxxy plugins list\|reload` | Manage plugin host. |

## Env vars

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Required for the default Anthropic provider. |
| `MOXXY_VAULT_PASSPHRASE` | Headless vault passphrase (alt to keychain). |
| `MOXXY_TELEGRAM_TOKEN` | Override the vault-stored Telegram bot token. |
| `MOXXY_FIXTURES` | `record\|replay\|passthrough` — fixture mode for tests. |
