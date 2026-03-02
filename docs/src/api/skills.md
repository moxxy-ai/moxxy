# Skills

Skills are Markdown documents with YAML frontmatter that define what an agent can do and which primitives it is allowed to invoke. All skills start in quarantine and must be explicitly approved before use.

## Skill Format

```markdown
---
id: code-review
name: Code Review
version: "1.0"
inputs_schema: {}
allowed_primitives:
  - fs.read
  - fs.list
  - memory.append
  - shell.exec
safety_notes: "Read-only access to workspace files."
---

# Instructions

You are a code review assistant. Review code for:
1. Security vulnerabilities
2. Performance issues
3. Code style violations
```

### Required Frontmatter Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique skill identifier |
| `name` | string | Human-readable display name |
| `version` | string | Semantic version |
| `inputs_schema` | object | JSON schema for inputs (`{}` for none) |
| `allowed_primitives` | list | Primitives this skill can invoke |
| `safety_notes` | string | Safety documentation for reviewers |

## Lifecycle

```
1. Install       POST /v1/agents/{id}/skills/install
                 Status: "quarantined"

2. Review        Inspect raw_content, allowed_primitives,
                 and safety_notes

3. Approve       POST /v1/agents/{id}/skills/approve/{skill_id}
                 Status: "approved"

4. Execute       During runs, primitives are checked against
                 the skill's allowed_primitives list
```

Skills can also be rejected, setting their status to `rejected`.

## Endpoints

### Install Skill

```
POST /v1/agents/{id}/skills/install
```

**Required scope**: `agents:write`

**Request body**:

```json
{
  "name": "code-review",
  "version": "1.0",
  "source": "local",
  "content": "---\nid: code-review\nname: Code Review\n..."
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Skill name |
| `version` | string | Yes | Skill version |
| `source` | string | No | Where the skill came from |
| `content` | string | Yes | Full skill document (YAML frontmatter + Markdown body) |

**Response** (201 Created):

The skill is created with `status: "quarantined"`. It must be approved before it can be used.

### List Skills

```
GET /v1/agents/{id}/skills
```

**Required scope**: `agents:read`

Returns all skills for the agent, including their status.

### Approve Skill

```
POST /v1/agents/{id}/skills/approve/{skill_id}
```

**Required scope**: `agents:write`

Sets the skill status to `approved` and records `approved_at`. The skill's `allowed_primitives` become active for the agent's runs.

### Reject Skill

```
POST /v1/agents/{id}/skills/reject/{skill_id}
```

**Required scope**: `agents:write`

Sets the skill status to `rejected`.

## Primitive Allowlist Enforcement

During a run, when the LLM requests a tool call, the runtime checks:

1. Is the primitive registered in the `PrimitiveRegistry`?
2. Is the primitive in the agent's active skill's `allowed_primitives`?

If either check fails, the call is rejected with `PrimitiveError::AccessDenied`.

This means that even though all 27 primitives are registered globally, each skill can only use the subset it declares. A `code-review` skill with `[fs.read, fs.list]` cannot invoke `fs.write` or `shell.exec`.

## Events

| Event | When |
|-------|------|
| `skill.invoked` | Skill execution begins |
| `skill.completed` | Skill execution finishes |
| `skill.failed` | Skill execution errors |

## CLI Usage

```bash
# Import a skill (interactive wizard)
moxxy skill import --agent <agent-id>

# Import with flags
moxxy skill import --agent <agent-id> --name code-review --content "$(cat skill.md)"

# Approve a quarantined skill
moxxy skill approve --agent <agent-id> --skill <skill-id>
```

## Example Skills

The repository includes example skills in `examples/skills/`:

| Skill | Primitives | Description |
|-------|------------|-------------|
| `code-review.md` | fs.read, fs.list, memory.append, shell.exec | Code review with structured output |
| `web-scraper.md` | http.request, fs.write, memory.append | Fetch and extract data from web pages |
| `webhook-notifier.md` | webhook.create, webhook.list, notify.webhook, notify.cli | Webhook management and notifications |
| `web-researcher.md` | browse.fetch, browse.extract, memory.append | Web research with CSS selectors |
| `git-workflow.md` | git.*, fs.read, fs.write | Full git workflow: clone, branch, edit, PR |
