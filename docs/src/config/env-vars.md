# Environment Variables

Moxxy is configured primarily through environment variables. All variables use the `MOXXY_` prefix.

## Gateway Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `MOXXY_HOST` | `0.0.0.0` | Host address the gateway binds to |
| `MOXXY_PORT` | `3000` | Port the gateway listens on |
| `MOXXY_DB_PATH` | `~/.moxxy/moxxy.db` | Path to the SQLite database file |
| `MOXXY_HOME` | `~/.moxxy` | Base data directory |

### Example

```bash
MOXXY_HOST=127.0.0.1 MOXXY_PORT=8080 cargo run -p moxxy-gateway
```

## Rate Limiting

| Variable | Default | Description |
|----------|---------|-------------|
| `MOXXY_RATE_LIMIT_PER_SEC` | `20` | Requests per second per client |
| `MOXXY_RATE_LIMIT_BURST` | `100` | Maximum burst size |
| `MOXXY_RATE_LIMIT_TOKEN_PER_SEC` | `10` | Token-specific rate limit per second |
| `MOXXY_RATE_LIMIT_TOKEN_BURST` | `60` | Token-specific burst size |

Rate limiting uses a token-bucket algorithm via `tower-governor`. Each client is identified by Bearer token, falling back to `x-forwarded-for` IP, then `anonymous`.

### Disabling Rate Limiting

Set very high values:

```bash
MOXXY_RATE_LIMIT_PER_SEC=100000 MOXXY_RATE_LIMIT_BURST=1000000
```

The health endpoint (`GET /v1/health`) is always exempt from rate limiting.

## CLI Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `MOXXY_API_URL` | `http://localhost:3000` | Gateway API base URL |
| `MOXXY_TOKEN` | (none) | API token for authentication |

### Example

```bash
export MOXXY_API_URL="http://localhost:3000"
export MOXXY_TOKEN="mox_a1b2c3d4..."
moxxy agent list
```

## LLM Provider API Keys

Provider API keys are typically stored in the vault (OS keychain), but can also be set as environment variables during provider installation:

| Variable | Provider | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Anthropic | Claude models |
| `OPENAI_API_KEY` | OpenAI | GPT models |
| `XAI_API_KEY` | xAI | Grok models |
| `GOOGLE_API_KEY` | Google Gemini | Gemini models |
| `DEEPSEEK_API_KEY` | DeepSeek | DeepSeek models |
| `ZAI_API_KEY` | ZAI | ZAI models |

When using the `moxxy provider install` wizard, the API key is securely stored in the vault rather than as an environment variable.

## Logging

| Variable | Default | Description |
|----------|---------|-------------|
| `RUST_LOG` | `info` | Log level filter (tracing-subscriber) |

Supports the `tracing-subscriber` env-filter syntax:

```bash
# Debug logs for the gateway only
RUST_LOG=moxxy_gateway=debug cargo run -p moxxy-gateway

# Trace-level for all moxxy crates
RUST_LOG=moxxy=trace cargo run -p moxxy-gateway

# Info for everything, debug for specific modules
RUST_LOG=info,moxxy_runtime::primitives=debug cargo run -p moxxy-gateway
```

## Database

| Variable | Default | Description |
|----------|---------|-------------|
| `MOXXY_DB_PATH` | `~/.moxxy/moxxy.db` | SQLite database path |

The database uses WAL (Write-Ahead Logging) mode for concurrent read access during writes. The `sqlite-vec` extension is loaded automatically for vector search support.

## Development

| Variable | Default | Description |
|----------|---------|-------------|
| `MOXXY_RATE_LIMIT_PER_SEC` | `20` | Set high for tests |
| `RUST_LOG` | `info` | Set to `debug` or `trace` for development |

### Test Configuration

During tests, the gateway uses in-memory SQLite databases and permissive rate limits. No environment variables are required.
