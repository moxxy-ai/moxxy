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

Create `src/skills/builtins/<skill_name>/` with 3-4 files: `manifest.toml`, `run.sh`, `skill.md`, and optionally `run.ps1` for cross-platform support.

**Unless the user explicitly requests a platform-specific skill (macOS-only or Windows-only), always create both `run.sh` and `run.ps1`** so the skill works on macOS, Linux, and Windows. For platform-specific skills, add `platform = "macos"` or `platform = "windows"` to the manifest and include an OS guard at the top of the script.

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

# Check response (use grep/sed instead of jq -- jq is not broadly available)
if ! printf '%s' "$resp" | grep -qE '"success"[[:space:]]*:[[:space:]]*true'; then
  err=$(printf '%s' "$resp" | sed -n 's/.*"error"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
  echo "Error: ${err:-operation failed}"
  exit 1
fi

msg=$(printf '%s' "$resp" | sed -n 's/.*"message"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
echo "${msg:-Done.}"
```

#### run.ps1 (create alongside run.sh for cross-platform skills)

PowerShell equivalent for Windows. Use this template:

```powershell
$ErrorActionPreference = "Stop"

if (-not $env:AGENT_NAME) {
    Write-Output "AGENT_NAME is required"
    exit 1
}

$apiBase = if ($env:MOXXY_API_BASE) { $env:MOXXY_API_BASE } else { "http://127.0.0.1:17890/api" }
$headers = @{
    "Content-Type" = "application/json"
    "X-Moxxy-Internal-Token" = $env:MOXXY_INTERNAL_TOKEN
}

if ($args.Count -lt 1) {
    Write-Output "Usage: <skill_name> '<arg>'"
    exit 1
}

$body = @{ key = $args[0] } | ConvertTo-Json
$resp = Invoke-RestMethod -Uri "$apiBase/your/endpoint" -Method Post -Body $body -Headers $headers
if ($resp.success) {
    Write-Output ($resp.message ?? "Done.")
} else {
    Write-Output "Error: $($resp.error ?? 'operation failed')"
    exit 1
}
```

Rules for run.ps1:
- Use `$ErrorActionPreference = "Stop"` at top
- PowerShell has native JSON support: `ConvertTo-Json`, `ConvertFrom-Json`, `Invoke-RestMethod`
- For form-urlencoded endpoints, use `[System.Net.WebUtility]::UrlEncode()` and `-ContentType "application/x-www-form-urlencoded"`
- Mirror the same argument validation and API logic as run.sh

Rules:
- Always start with `#!/bin/sh` and `set -eu`
- **Must be cross-system compatible** (macOS + Linux) unless the user explicitly requests a platform-specific skill
- **Never use `jq`** -- it crashes on systems where it is not installed. Use `grep`/`sed`/`awk` for JSON parsing
- Only depend on universally available tools: `sh`, `curl`, `grep`, `sed`, `awk`, `printf`, `cat`, `tr`, `cut`
- Validate required arguments
- Use `$MOXXY_API_BASE` with fallback for API calls
- Include `X-Moxxy-Internal-Token` header on API calls
- Check `.success` field using `grep -qE '"success"[[:space:]]*:[[:space:]]*true'`
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
- If cross-platform: `run.ps1` exists and mirrors run.sh logic
- If platform-specific: `platform` field in manifest; OS guard at top of script returns JSON error on wrong OS
- `skill.md` has clear usage instructions and examples

### 5. Build and Verify

Run `cargo build --release` to compile. The new skill is automatically embedded via `include_dir!` -- no Rust code changes needed.

If the build fails, fix the issue and rebuild.
