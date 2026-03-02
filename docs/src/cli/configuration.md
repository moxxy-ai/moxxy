# CLI Configuration

The CLI uses environment variables and a local configuration directory to manage settings.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MOXXY_API_URL` | `http://localhost:3000` | Gateway API base URL |
| `MOXXY_TOKEN` | (none) | API token for authentication |
| `MOXXY_HOME` | `~/.moxxy` | Data directory for database, agents, and config |

These can be set in your shell profile (`~/.bashrc`, `~/.zshrc`), in a `.env` file, or passed directly:

```bash
MOXXY_API_URL=http://localhost:8080 MOXXY_TOKEN=mox_abc... moxxy agent list
```

## Data Directory

The default data directory is `~/.moxxy/`. It contains:

```
~/.moxxy/
├── moxxy.db                # SQLite database (WAL mode)
├── config/                 # Configuration files
│   └── default.json        # Base URL, token reference
└── agents/
    └── {agent-id}/
        ├── workspace/      # Agent working directory
        └── memory/         # Agent memory journal
            ├── 2026-03-01T10-00-00.md
            └── 2026-03-02T14-30-00.md
```

Override with `MOXXY_HOME`:

```bash
export MOXXY_HOME=/opt/moxxy
```

## API Client

The CLI creates an API client on startup using:

```javascript
const baseUrl = process.env.MOXXY_API_URL || 'http://localhost:3000';
const token = process.env.MOXXY_TOKEN || '';
const client = createApiClient(baseUrl, token);
```

All CLI commands use this client to communicate with the gateway. If the token is not set, commands that require authentication will fail with an appropriate error message.

## Config File

The `moxxy init` wizard creates a configuration file at `~/.moxxy/config/default.json`:

```json
{
  "base_url": "http://localhost:3000",
  "token_id": "019cac12-..."
}
```

This is primarily used by the init/doctor commands to verify the setup. The actual token for API calls comes from `MOXXY_TOKEN`.

## Token Management

Tokens are sensitive and should not be stored in plain configuration files. Recommended approaches:

1. **Environment variable**: Set `MOXXY_TOKEN` in your shell profile
2. **Shell alias**: Create an alias that sources the token from a secure store
3. **Direnv**: Use `.envrc` per project to set project-specific tokens

```bash
# ~/.zshrc
export MOXXY_TOKEN="mox_your_token_here"

# Or per-project with direnv (.envrc)
export MOXXY_TOKEN="mox_project_specific_token"
```

## Remote Gateway

To connect to a non-local gateway:

```bash
export MOXXY_API_URL="https://moxxy.internal.company.com:3000"
export MOXXY_TOKEN="mox_..."
moxxy agent list
```

The CLI will use the specified URL for all API calls. Ensure the gateway has CORS configured to accept requests from your client.
