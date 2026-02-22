Create a new built-in skill for the moxxy agent framework.

Skill request: $ARGUMENTS

## Instructions

### 1. Understand the Request

Parse the skill name and description from the request above. The format is typically `<name> - <description>` or just a description from which you should derive a good snake_case name.

### 2. Read Reference Materials

Read these files to understand the patterns:

- `docs/skills-authoring.md` -- Complete authoring guide
- `src/skills/builtins/telegram_notify/manifest.toml` -- Simple manifest example
- `src/skills/builtins/telegram_notify/run.sh` -- Clean API-calling pattern
- `src/skills/builtins/telegram_notify/skill.md` -- Documentation format
- `src/skills/builtins/host_shell/run.sh` -- Stdin JSON handling pattern (for large args)
- `docs/api-reference.md` -- Available API endpoints the skill can call

### 3. Create the Skill Directory

Create `src/skills/builtins/<skill_name>/` with exactly 3 files:

#### manifest.toml

```toml
name = "<skill_name>"
description = "<One-line description for the LLM skill catalog>"
version = "1.0.0"
needs_network = <true if making HTTP calls, false otherwise>
needs_fs_read = <true if reading files>
needs_fs_write = <true if writing files>
needs_env = <true ONLY if vault secrets needed as env vars>
run_command = "sh"
entrypoint = "run.sh"
```

Rules:
- `name` MUST match the directory name exactly
- `name` MUST be snake_case
- `description` should be concise but descriptive enough for the LLM to know when to use it
- Only set capability flags to `true` when actually needed

#### run.sh

Use `#!/bin/sh` with `set -eu`. Follow this template:

```bash
#!/bin/sh
set -eu

if [ -z "${AGENT_NAME:-}" ]; then
  echo "AGENT_NAME is required"
  exit 1
fi

API_BASE="${MOXXY_API_BASE:-http://127.0.0.1:17890/api}"

# Validate arguments
if [ "$#" -lt 1 ]; then
  echo "Usage: <skill_name> '<arg>'"
  exit 1
fi

# Your logic here...
arg1="$1"

# Make API call (if needed)
resp=$(curl -sS -X POST \
  -H "Content-Type: application/json" \
  -H "X-Moxxy-Internal-Token: $MOXXY_INTERNAL_TOKEN" \
  -d "{\"key\": \"$arg1\"}" \
  "${API_BASE}/your/endpoint")

# Check response
success=$(printf '%s' "$resp" | jq -r '.success // false')
if [ "$success" != "true" ]; then
  err=$(printf '%s' "$resp" | jq -r '.error // "operation failed"')
  echo "Error: $err"
  exit 1
fi

printf '%s\n' "$resp" | jq -r '.message // "Done."'
```

Rules:
- Always start with `#!/bin/sh` and `set -eu`
- Validate required arguments
- Use `$MOXXY_API_BASE` with fallback for API calls
- Include `X-Moxxy-Internal-Token` header on API calls
- Check `.success` field from API responses
- Exit 0 on success, non-zero on failure
- Output results to stdout

#### skill.md

```markdown
# <Skill Name>

<Description of what the skill does and when to use it.>

## Usage

- `$1` (required): <description>
- `$2` (optional): <description>

## Examples

\```
<skill_name> "argument1"
\```

\```
<skill_name> "argument1" "argument2"
\```

## Notes
- <Any prerequisites or caveats>
```

### 4. Validate

- Skill name is snake_case and matches directory name
- `manifest.toml` is valid TOML (no syntax errors)
- `run.sh` has `#!/bin/sh` shebang and `set -eu`
- `skill.md` has clear usage instructions and examples

### 5. Build and Verify

Run `cargo build --release` to compile. The new skill is automatically embedded via `include_dir!` -- no Rust code changes needed.

If the build fails, fix the issue and rebuild.
