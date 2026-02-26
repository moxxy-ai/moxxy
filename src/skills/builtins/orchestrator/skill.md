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
- `jobs get <job_id>`
- `jobs workers <job_id>`
- `jobs events <job_id>`
- `jobs stream <job_id>`
- `jobs cancel <job_id>`
- `jobs approve-merge <job_id>`

## Notes
- The tool targets the current `AGENT_NAME` by default.
- JSON payloads must be valid JSON objects.

## Example
<invoke name="orchestrator">jobs|start|{"prompt":"Build a kanban orchestrator","worker_mode":"mixed","existing_agents":["default"],"ephemeral":{"count":1}}</invoke>
