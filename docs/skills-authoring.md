# Built-in Skill Authoring Guide

This guide covers everything needed to create a new built-in skill for moxxy.

## Quick Start

1. Create a directory: `src/skills/builtins/<skill_name>/`
2. Add three files: `manifest.toml`, `run.sh`, `skill.md`
3. Build: `cargo build --release`
4. Done. The skill is automatically embedded in the binary.

No Rust code changes are needed. The `include_dir!` macro in `src/skills/mod.rs` embeds the entire `src/skills/builtins/` directory at compile time.

## Directory Structure

```
src/skills/builtins/
  your_skill/
    manifest.toml    # Skill metadata and capabilities
    run.sh           # Entry point script (or run.py)
    skill.md         # Documentation for the LLM
```

## manifest.toml Reference

All fields from the `SkillManifest` struct (`src/skills/mod.rs:19-53`):

```toml
# Required
name = "your_skill"          # Unique identifier, must match directory name, snake_case
description = "One-line description of what this skill does."  # Shown in LLM skill catalog
version = "1.0.0"            # Semver string

# Optional (defaults shown)
executor_type = "native"     # "native", "wasm", "mcp", or "openclaw"
entrypoint = "run.sh"        # Script to execute
run_command = "sh"            # Shell interpreter (sh, bash, python3)

# Capability flags (all default to false)
needs_network = false        # true if skill makes HTTP requests
needs_fs_read = false        # true if skill reads files on disk
needs_fs_write = false       # true if skill writes files on disk
needs_env = false            # true to inject all vault secrets as env vars
```

### Field Details

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Must be snake_case, must match the directory name exactly |
| `description` | string | One-line summary. This is what the LLM sees in the skill catalog to decide when to use it |
| `version` | string | Semver. Used by `upgrade_skill` to validate upgrades |
| `executor_type` | string | Almost always `"native"`. Use `"mcp"` for MCP tool proxies |
| `needs_network` | bool | Set `true` if the script makes any HTTP/network calls |
| `needs_fs_read` | bool | Set `true` if the script reads files from the filesystem |
| `needs_fs_write` | bool | Set `true` if the script writes files to the filesystem |
| `needs_env` | bool | Set `true` to inject **all vault secrets** as environment variables. Use sparingly |
| `entrypoint` | string | Script filename. Usually `run.sh` but can be `run.py` etc. |
| `run_command` | string | Interpreter. Use `sh` for shell, `bash` for bash-specific features, `python3` for Python |

## Cross-System Compatibility

All skills **must** be portable across macOS and Linux unless the skill is explicitly platform-specific (e.g. `osx_email` which uses AppleScript). Follow these rules:

- Use `#!/bin/sh` (POSIX sh), not `#!/bin/bash`, unless bash-specific features are truly needed
- **Never depend on `jq`** -- it is not installed on many systems and causes skills to crash. Use `grep`, `sed`, and `awk` for JSON parsing instead
- Avoid GNU-only flags (e.g. `sed -i ''` on macOS vs `sed -i` on Linux). Prefer writing to a temp file and `mv`
- Only rely on tools that are universally available: `sh`, `curl`, `grep`, `sed`, `awk`, `printf`, `cat`, `tr`, `cut`, `head`, `tail`, `wc`
- If complex JSON parsing is unavoidable, use `python3` as a fallback (far more available than `jq`) and check for it with `command -v python3`

Common portable JSON helpers:

```bash
# Escape a string for embedding in JSON values
_esc() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | awk 'NR>1{printf "%s","\\n"}{printf "%s",$0}'; }

# Extract a string field from JSON (with default)
# Usage: _jv "$json" "field_name" "default_value"
_jv() { v=$(printf '%s' "$1" | sed -n 's/.*"'"$2"'"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1); printf '%s' "${v:-$3}"; }

# Build JSON: printf '{"key":"%s"}' "$(_esc "$value")"
# Check success: printf '%s' "$resp" | grep -qE '"success"[[:space:]]*:[[:space:]]*true'
```

## run.sh Patterns

### Environment Variables Available

Every skill script receives these environment variables automatically:

| Variable | Value |
|----------|-------|
| `AGENT_NAME` | Current agent's name (e.g., `default`) |
| `AGENT_HOME` | Agent's home directory (`~/.moxxy/agents/<name>/`) |
| `AGENT_WORKSPACE` | Agent's workspace path (`~/.moxxy/agents/<name>/workspace/`) |
| `MOXXY_API_BASE` | API base URL (default: `http://127.0.0.1:17890/api`) |
| `MOXXY_INTERNAL_TOKEN` | Auth token for internal API calls |
| `MOXXY_ARGS_MODE` | Set to `"stdin"` when args are passed via stdin (large payloads) |
| `MOXXY_SOURCE_DIR` | Source dir (dev mode only, for `evolve_core`) |

If `needs_env = true`, all vault secrets are also injected as environment variables.

### Pattern 1: Simple Arguments (recommended for most skills)

Based on `telegram_notify/run.sh` -- the cleanest example:

```bash
#!/bin/sh
set -eu

if [ -z "${AGENT_NAME:-}" ]; then
  echo "AGENT_NAME is required"
  exit 1
fi

API_BASE="${MOXXY_API_BASE:-http://127.0.0.1:17890/api}"

if [ "$#" -lt 1 ]; then
  echo "Usage: your_skill '<argument>'"
  exit 1
fi

message="$1"

resp=$(curl -sS -X POST \
  -H "Content-Type: application/json" \
  -H "X-Moxxy-Internal-Token: $MOXXY_INTERNAL_TOKEN" \
  -d "{\"key\": \"$message\"}" \
  "${API_BASE}/agents/${AGENT_NAME}/your_endpoint")

if ! printf '%s' "$resp" | grep -qE '"success"[[:space:]]*:[[:space:]]*true'; then
  err=$(printf '%s' "$resp" | sed -n 's/.*"error"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
  echo "Error: ${err:-operation failed}"
  exit 1
fi

msg=$(printf '%s' "$resp" | sed -n 's/.*"message"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
echo "${msg:-Done.}"
```

### Pattern 2: Stdin JSON Handling (for large payloads)

Based on `host_shell/run.sh` -- handles both CLI args and stdin:

```bash
#!/bin/sh

_esc() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | awk 'NR>1{printf "%s","\\n"}{printf "%s",$0}'; }

# Read command from CLI arg or stdin (for large payloads exceeding OS limits)
if [ -n "$1" ]; then
    CMD="$1"
elif [ "$MOXXY_ARGS_MODE" = "stdin" ]; then
    # Args arrive as a JSON array on stdin; extract the first string element
    raw_input=$(cat)
    CMD=$(printf '%s' "$raw_input" | sed 's/^\["//' | sed 's/"\]$//' | sed 's/\\"/"/g' | sed 's/\\\\/\\/g')
else
    echo "Usage: your_skill '<argument>'"
    exit 1
fi

if [ -z "$CMD" ]; then
    echo "Error: empty argument"
    exit 1
fi

# Make API call
JSON_PAYLOAD=$(printf '{"command":"%s"}' "$(_esc "$CMD")")
curl -s -X POST -H "Content-Type: application/json" \
    -H "X-Moxxy-Internal-Token: $MOXXY_INTERNAL_TOKEN" \
    -d "$JSON_PAYLOAD" \
    ${MOXXY_API_BASE:-http://127.0.0.1:17890/api}/host/execute_bash
```

### Pattern 3: Multi-argument Skills

Based on `delegate_task/run.sh`:

```bash
#!/bin/sh
set -eu

TARGET_AGENT="$1"
PROMPT="$2"

[ -z "$TARGET_AGENT" ] || [ -z "$PROMPT" ] && {
    echo "Usage: delegate_task '<agent_name>' '<prompt>'"
    exit 1
}

resp=$(curl -s -X POST \
    -H "Content-Type: text/plain" \
    -d "$PROMPT" \
    "${MOXXY_API_BASE}/agents/$TARGET_AGENT/delegate")

printf '%s' "$resp" | sed -n 's/.*"response"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1
```

### Pattern 4: No API Call (local operation)

Some skills don't need the API at all:

```bash
#!/bin/sh
set -eu

# Direct filesystem or command execution
cd "$AGENT_WORKSPACE"
git "$@"
```

### Error Handling Best Practices

- Always use `set -eu` at the top (exit on error, exit on undefined variable)
- Validate required arguments before doing anything
- Check `$AGENT_NAME` if you make API calls (it's always set, but good to verify)
- Use `grep`/`sed` to parse JSON responses (do NOT use `jq` -- it is not broadly available)
- Check the `.success` field from API responses using `grep -q '"success".*true'`
- Exit with code 0 on success, non-zero on failure
- Write errors to stdout (not stderr) -- the skill result is captured from stdout

## skill.md Format

The skill.md file is included in the LLM's skill catalog. Keep it concise but comprehensive.

```markdown
# Skill Name

One-line description of what the skill does and when to use it.

## Usage

Describe the parameters:
- `$1` (required): Description of first argument
- `$2` (optional): Description of second argument

## Examples

\```
your_skill "argument1"
\```

\```
your_skill "argument1" "argument2"
\```

## Notes
- Any caveats or prerequisites
- What must be configured first (vault keys, etc.)
```

The LLM sees this documentation alongside the manifest description when deciding which skill to invoke. Write it so the LLM can understand when and how to use the skill.

## How Skills Get Compiled

1. `src/skills/mod.rs` line 16:
   ```rust
   static BUILTINS_DIR: Dir = include_dir!("$CARGO_MANIFEST_DIR/src/skills/builtins");
   ```
2. At compile time, `include_dir!` embeds every file in `src/skills/builtins/` into the binary
3. At runtime, `SkillManager::on_init()` extracts these files to `~/.moxxy/agents/<name>/skills/`
4. `SkillManager::load_skills_from_dir()` scans for `manifest.toml` files and registers each skill

**No Rust code changes are needed to add a skill.** Just add the directory and rebuild.

## Protected Skills

These built-in skills cannot be removed by agents at runtime (defined in `src/skills/mod.rs`):

```
skill, host_shell, delegate_task, evolve_core, computer_control, browser,
example_skill, telegram_notify, discord_notify, whatsapp_notify, git,
scheduler, remove_schedule, modify_schedule, webhook, openclaw_migrate, contribute
```

If your new skill should be protected, add it to the `PROTECTED_SKILLS` array in `src/skills/mod.rs:488`.

## Complete Examples

### Example 1: telegram_notify (simple API-calling skill)

**manifest.toml:**
```toml
name = "telegram_notify"
description = "Send a proactive message to the paired Telegram user for this agent."
version = "v1.0.0"
needs_network = true
run_command = "sh"
entrypoint = "run.sh"
```

**run.sh:** Joins all arguments into a message, POSTs to `/api/agents/{agent}/channels/telegram/send`, checks `.success` field, prints result.

**skill.md:** Explains usage, notes that Telegram must be configured and paired first.

### Example 2: host_shell (stdin JSON handling)

**manifest.toml:**
```toml
name = "host_shell"
description = "Executes arbitrary terminal bash commands natively on the underlying host operating system."
version = "v1.0.0"
needs_network = true
run_command = "sh"
entrypoint = "run.sh"
```

**run.sh:** Reads command from `$1` or stdin JSON. Builds JSON payload with optional `cwd` from `$AGENT_WORKSPACE`. POSTs to `/api/host/execute_bash` with `X-Moxxy-Internal-Token` header.

### Example 3: browser (complex with background process)

**manifest.toml:**
```toml
name = "browser"
description = "Interactive browser automation -- navigate, click, type, screenshot, and read web pages."
version = "v1.0.0"
executor_type = "native"
needs_network = true
needs_fs_read = false
needs_fs_write = false
needs_env = false
entrypoint = "run.sh"
run_command = "sh"
```

**run.sh:** Manages a background browser bridge process (Python Flask server). Has a `fetch` fast path for simple URL reads. All other actions go through the bridge via JSON HTTP calls. Handles bridge startup, PID file management, and health checks.

## Testing Your Skill

1. Build: `cargo build --release`
2. Start moxxy: `./target/release/moxxy web`
3. Open the web dashboard at `http://127.0.0.1:3000`
4. Go to the **Skills** tab -- verify your skill appears in the list
5. Go to the **Chat** tab and ask the agent to use your skill
6. Or test via API:
   ```bash
   curl -X POST http://127.0.0.1:17890/api/agents/default/chat \
     -H "Content-Type: application/json" \
     -d '{"message": "Use the your_skill skill with argument X"}'
   ```

## API Endpoints for Skill Scripts

Skills commonly call these endpoints (see `docs/api-reference.md` for the full list):

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/host/execute_bash` | POST | Execute shell commands |
| `/api/host/execute_python` | POST | Execute Python code |
| `/api/agents/{agent}/channels/telegram/send` | POST | Send Telegram message |
| `/api/agents/{agent}/channels/discord/send` | POST | Send Discord message |
| `/api/agents/{agent}/channels/whatsapp/send` | POST | Send WhatsApp message |
| `/api/agents/{agent}/delegate` | POST | Delegate task to another agent |
| `/api/agents/{agent}/vault` | GET/POST | Read/write secrets |
| `/api/agents/{agent}/schedules` | GET/POST | Manage cron jobs |
| `/api/agents/{agent}/webhooks` | GET/POST | Manage webhooks |
| `/api/agents/{agent}/mcp` | GET/POST | Manage MCP servers |

Always include `X-Moxxy-Internal-Token: $MOXXY_INTERNAL_TOKEN` header for authenticated endpoints.
