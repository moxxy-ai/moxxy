# `orchestrator` Tool

## Description
Manage per-agent ReActOr configuration, persona templates, and orchestration jobs through the API.

## Parameters
1. **Resource**: `config`, `templates`, or `jobs`.
2. **Action**: depends on resource.
3. **Arg1**: optional ID or JSON payload.
4. **Arg2**: optional JSON payload (used by `templates patch`).

## Actions
- `config get`
- `config set <json_payload>`
- `templates list`
- `templates get <template_id>`
- `templates upsert <json_payload>`
- `templates patch <template_id> <json_payload>`
- `templates delete <template_id>`
- `jobs start <json_payload>`
- `jobs run <json_payload>` — same as `start` but blocks until job completes; returns final status and workers
- `jobs get <job_id>`
- `jobs workers <job_id>`
- `jobs events <job_id>`
- `jobs stream <job_id>`
- `jobs cancel <job_id>`
- `jobs approve-merge <job_id>`

## Notes
- The tool targets the current `AGENT_NAME` by default.
- JSON payloads must be valid JSON objects.

## Examples

**Simple job:**
<invoke name="orchestrator">jobs|start|{"prompt":"Build a kanban orchestrator","worker_mode":"mixed","existing_agents":["default"],"ephemeral":{"count":1}}</invoke>

**Builder–checker–merger with PR:**
<invoke name="orchestrator">jobs|run|{"prompt":"Build feature XXX in moxxy-ai/moxxy and open a PR","phases":["builder","checker","merger"],"merge_action":"merge_and_pr","worker_mode":"ephemeral","ephemeral":{"count":3}}</invoke>

The template `builder-checker-merger` defines three phases: `builder` produces code, `checker` validates (on failure the job stops), `merger` runs only if all prior phases succeed and uses the `merge_action` to open a PR.

**Per-role provider and model:** Each spawn profile in a template specifies `provider`, `model`, and `persona`. Ephemeral agents use the profile matching their role (by name). For example, a checker can use `google`/`gemini-2.5-flash` while the builder uses `openai`/`gpt-4o`.
