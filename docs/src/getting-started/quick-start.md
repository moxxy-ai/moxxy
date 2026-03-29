# Quick Start

This guide walks through the core workflow: start the gateway, create a token, set up a provider, create an agent, and run a task.

## The Easy Way (Interactive Wizards)

Every CLI command launches an interactive wizard when run without flags:

```bash
moxxy init              # Setup wizard: gateway, token, config
moxxy provider install  # Pick a provider, configure API key
moxxy agent create      # Guided agent creation
moxxy tui               # Full-screen chat interface
```

## The Scripted Way

### Step 1: Start the Gateway

The gateway is the Axum HTTP server that handles all API requests and SSE event streaming.

```bash
# Option A: Run from source
cargo run -p moxxy-gateway --release

# Option B: Use the CLI
moxxy gateway start
```

The gateway starts on `http://localhost:3000` by default. You can change this with `MOXXY_HOST` and `MOXXY_PORT` environment variables.

Verify it is running:

```bash
curl http://localhost:3000/v1/health
# {"status":"ok"}
```

### Step 2: Create a Bootstrap Token

The first token can be created without authentication (bootstrap mode). Subsequent token creation requires the `tokens:admin` scope.

```bash
curl -X POST http://localhost:3000/v1/auth/tokens \
  -H "Content-Type: application/json" \
  -d '{
    "scopes": [
      "tokens:admin",
      "agents:write",
      "agents:read",
      "runs:write",
      "events:read",
      "vault:read",
      "vault:write"
    ]
  }'
```

Response:

```json
{
  "id": "019cac12-...",
  "token": "mox_a1b2c3d4...",
  "scopes": ["tokens:admin", "agents:write", ...],
  "created_at": "2026-03-02T12:00:00Z",
  "expires_at": null,
  "status": "active"
}
```

Save the token -- it is only returned once:

```bash
export MOXXY_TOKEN="mox_a1b2c3d4..."
```

Or use the CLI:

```bash
moxxy auth token create --scopes tokens:admin,agents:write,agents:read,runs:write,events:read
```

### Step 3: Install a Provider

Providers supply the LLM backend. Moxxy includes a built-in catalog for Anthropic, OpenAI, Ollama, xAI, Google Gemini, and DeepSeek.

```bash
# Interactive
moxxy provider install

# Or install directly
moxxy provider install --id anthropic
```

For API-based providers, you will be prompted for the API key, which is stored in the OS keychain via the vault.

Verify installed providers:

```bash
curl http://localhost:3000/v1/providers \
  -H "Authorization: Bearer $MOXXY_TOKEN"
```

### Step 4: Create an Agent

```bash
curl -X POST http://localhost:3000/v1/agents \
  -H "Authorization: Bearer $MOXXY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "provider_id": "anthropic",
    "model_id": "claude-sonnet-4-20250514",
    "workspace_root": "/home/user/my-project"
  }'
```

Or via CLI:

```bash
moxxy agent create --provider anthropic \
  --model claude-sonnet-4-20250514 \
  --workspace ~/my-project
```

### Step 5: Start a Run

```bash
curl -X POST http://localhost:3000/v1/agents/{agent-id}/runs \
  -H "Authorization: Bearer $MOXXY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"task": "Refactor the auth module for better testability"}'
```

Or via CLI:

```bash
moxxy agent run --id <agent-id> --task "Refactor the auth module"
```

### Step 6: Watch Events

In a separate terminal, stream live events:

```bash
# Via curl (SSE)
curl -N http://localhost:3000/v1/events/stream?agent_id={agent-id} \
  -H "Authorization: Bearer $MOXXY_TOKEN"

# Via CLI
moxxy events tail --agent <agent-id>
```

Events arrive as SSE `data:` lines with JSON payloads containing the event type, agent ID, and action details.

## Next Steps

- [Hello World Agent](hello-world.md) -- A step-by-step walkthrough of your first agent
- [CLI Commands](../cli/commands.md) -- Full CLI reference
- [API Authentication](../api/authentication.md) -- Token scopes and lifecycle
