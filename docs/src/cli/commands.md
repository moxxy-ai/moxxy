# CLI Commands

The Moxxy CLI (`moxxy`) provides both interactive wizards and scriptable flag-based commands. When run without sufficient flags in a TTY, commands launch interactive prompts powered by `@clack/prompts`.

## General Usage

```
moxxy                        Interactive menu (pick a command)
moxxy <command> [flags]      Run a specific command
moxxy help                   Show help text
moxxy --help                 Show help text
```

## init

First-time setup wizard. Checks/starts the gateway, creates a bootstrap token, and saves configuration.

```bash
moxxy init
```

## auth

Manage API tokens.

```bash
# Create a token (interactive)
moxxy auth token create

# Create with flags
moxxy auth token create --scopes agents:read,agents:write,runs:write --ttl 3600

# List all tokens
moxxy auth token list
moxxy auth token list --json

# Revoke a token
moxxy auth token revoke <token-id>
```

## agent

Create and manage agents.

```bash
# Create agent (interactive wizard)
moxxy agent create

# Create with flags
moxxy agent create --provider anthropic --model claude-sonnet-4-20250514 --workspace ~/project

# Start a run
moxxy agent run --id <agent-id> --task "Write tests for the auth module"

# Stop a running agent
moxxy agent stop --id <agent-id>

# Check agent status
moxxy agent status --id <agent-id>
moxxy agent status --id <agent-id> --json
```

## provider

Manage LLM providers.

```bash
# Install provider (interactive wizard with catalog)
moxxy provider install

# Install specific provider
moxxy provider install --id anthropic

# List installed providers
moxxy provider list
```

### Built-in Provider Catalog

| Provider | Models | API Key Env |
|----------|--------|-------------|
| Anthropic | Claude Sonnet 5, Opus 4, Sonnet 4, Haiku 4 | `ANTHROPIC_API_KEY` |
| OpenAI | GPT-5.2, GPT-4.1, o3, o4-mini, GPT-4o | `OPENAI_API_KEY` |
| xAI | Grok 4, Grok 3, Grok 3 Mini/Fast | `XAI_API_KEY` |
| Google Gemini | Gemini 3.1 Pro, 2.5 Pro/Flash | `GOOGLE_API_KEY` |
| DeepSeek | V4, R1, V3 | `DEEPSEEK_API_KEY` |
| Custom | Any model ID | Any env var |

## skill

Import and manage agent skills.

```bash
# Import skill (interactive)
moxxy skill import --agent <agent-id>

# Import with flags
moxxy skill import --agent <agent-id> --name code-review --content "$(cat skill.md)"

# Approve a quarantined skill
moxxy skill approve --agent <agent-id> --skill <skill-id>
```

## heartbeat

Schedule periodic agent actions.

```bash
# Set heartbeat (interactive)
moxxy heartbeat set --agent <agent-id>

# Set with flags
moxxy heartbeat set --agent <agent-id> --interval 60 --action_type notify_cli

# List heartbeats
moxxy heartbeat list --agent <agent-id>
```

## vault

Manage secrets.

```bash
# Add a secret (interactive)
moxxy vault add

# Add with flags
moxxy vault add --key github-token --backend moxxy-github-token

# Grant agent access to a secret
moxxy vault grant --agent <agent-id> --secret <secret-ref-id>
```

## channel

Manage Telegram/Discord channels.

```bash
# Create channel (interactive)
moxxy channel create

# List channels
moxxy channel list

# Pair a chat to an agent
moxxy channel pair --code 123456 --agent <agent-id>

# List bindings for a channel
moxxy channel bindings <channel-id>

# Unbind a chat from an agent
moxxy channel unbind <channel-id> <binding-id>

# Delete a channel
moxxy channel delete <channel-id>
```

## events

Stream live events.

```bash
# Stream all events
moxxy events tail

# Filter by agent
moxxy events tail --agent <agent-id>

# Filter by run
moxxy events tail --agent <agent-id> --run <run-id>

# JSON output
moxxy events tail --json
```

## gateway

Manage the gateway process.

```bash
moxxy gateway start      # Start the gateway in the background
moxxy gateway stop       # Stop the gateway
moxxy gateway restart    # Restart the gateway
moxxy gateway status     # Show gateway status
moxxy gateway logs       # Tail gateway logs
```

## tui / chat

Launch the full-screen chat interface.

```bash
moxxy tui                    # Auto-select or pick agent
moxxy tui --agent <agent-id> # Specify agent
moxxy chat --agent <agent-id> # Alias for tui
```

See the [TUI documentation](tui.md) for details.

## doctor

Diagnose the installation and check component health.

```bash
moxxy doctor
```

Checks:
- Rust toolchain version
- Node.js version
- Gateway reachability
- Database connectivity
- API token validity

## uninstall

Remove all Moxxy data.

```bash
moxxy uninstall
```

Prompts for confirmation before removing `~/.moxxy/` and associated data.

## JSON Output

Most commands support `--json` for machine-readable output:

```bash
moxxy auth token list --json
moxxy agent status --id <agent-id> --json
moxxy events tail --agent <agent-id> --json
```
