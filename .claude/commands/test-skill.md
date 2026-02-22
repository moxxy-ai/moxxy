Test and validate a built-in skill end-to-end.

Skill to test: $ARGUMENTS

## Steps

### 1. Verify Skill Files

Check that all required files exist in `src/skills/builtins/$ARGUMENTS/`:
- `manifest.toml` -- Read it and verify all required fields are present
- `run.sh` -- Check for proper shebang, argument handling, error handling
- `skill.md` -- Verify documentation exists and is helpful

### 2. Validate manifest.toml

Read the manifest and check:
- `name` matches the directory name `$ARGUMENTS`
- `name` is snake_case
- `description` is present and descriptive
- `version` is valid semver
- Capability flags (`needs_network`, `needs_fs_read`, `needs_fs_write`, `needs_env`) are appropriate for what `run.sh` does
- `run_command` and `entrypoint` point to the correct script

### 3. Validate run.sh

Read the script and check:
- Has proper shebang (`#!/bin/sh` or `#!/bin/bash`)
- Uses `set -eu` for safety
- Validates required arguments before operating
- Handles the `MOXXY_ARGS_MODE=stdin` case if the skill may receive large payloads
- Uses `$MOXXY_API_BASE` with a fallback default for API calls
- Includes `X-Moxxy-Internal-Token` header on API calls
- Checks API response `.success` field
- Exits with proper codes (0 for success, non-zero for failure)
- Outputs useful results to stdout

### 4. Validate skill.md

Read the doc and check:
- Explains when and why to use the skill
- Documents all parameters
- Provides example invocations
- Lists any prerequisites (vault keys, channel configs, etc.)

### 5. Build

Run `cargo build --release` to verify the skill compiles into the binary.

### 6. Provide Test Commands

Show the user how to test the skill:

```bash
# Start moxxy
./target/release/moxxy web

# Test via chat API
curl -X POST http://127.0.0.1:17890/api/agents/default/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Use the $ARGUMENTS skill to <appropriate test prompt>"}'

# Or open the web dashboard
open http://127.0.0.1:3000
# Go to Skills tab to verify it appears, then Chat tab to test
```

### 7. Report

Summarize findings: any issues found, fixes applied, and the skill's readiness status.
