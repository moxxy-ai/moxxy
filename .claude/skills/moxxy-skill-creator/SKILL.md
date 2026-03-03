---
name: moxxy-skill-creator
description: >
  This skill should be used when the user asks to "create a moxxy skill", "write a new skill",
  "add a skill for an agent", "scaffold a skill", "generate a skill template", or discusses
  building custom skills for Moxxy agents. Also trigger when the user mentions "skill frontmatter",
  "allowed primitives", "inputs_schema", or wants to define what an agent can do.
version: 0.1.0
---

# Moxxy Skill Creator

Create well-structured Moxxy skill documents that agents can use to perform specialized tasks.
Moxxy skills are Markdown files with YAML frontmatter that define an agent's capabilities,
permitted tools (primitives), and behavioral instructions.

## Skill Document Format

Every Moxxy skill is a single `.md` file with this structure:

```markdown
---
id: skill-id
name: Human-Readable Name
version: "1.0"
inputs_schema:
  param_name:
    type: string
    description: What this parameter does
allowed_primitives:
  - namespace.action
  - namespace.action2
safety_notes: "Brief security considerations for reviewers."
---

# Skill Title

Instructions for the agent go here in Markdown.
```

## Required Frontmatter Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique kebab-case identifier (e.g., `code-review`) |
| `name` | string | Human-readable display name |
| `version` | string | Semantic version, always quoted (e.g., `"1.0"`) |
| `inputs_schema` | object | JSON Schema for skill inputs (`{}` if none needed) |
| `allowed_primitives` | list | Primitives the agent can invoke (must not be empty) |
| `safety_notes` | string | Security documentation for human reviewers |

## Skill Creation Workflow

### 1. Clarify Intent

Ask the user:
- What task should the agent perform?
- What inputs does it need from the user?
- Does it need filesystem, network, git, or other access?
- Are there security constraints to consider?

### 2. Select Primitives

Choose the minimum set of primitives needed. Apply the principle of least privilege:
only grant what the skill actually requires. Consult `references/primitives.md` for the
full list of 33 available primitives organized by namespace.

Common primitive combinations:
- **Read-only analysis**: `fs.read`, `fs.list`, `memory.append`
- **Code generation**: `fs.read`, `fs.write`, `fs.list`, `shell.exec`, `git.commit`
- **Web research**: `browse.fetch`, `browse.extract`, `memory.append`
- **Monitoring**: `http.request`, `heartbeat.create`, `heartbeat.list`, `notify.webhook`
- **Full git workflow**: `git.clone`, `git.checkout`, `git.commit`, `git.push`, `git.pr_create`

### 3. Define inputs_schema

Use JSON Schema types within YAML. Common patterns:

```yaml
# Simple string input
inputs_schema:
  query:
    type: string
    description: Search query

# Multiple typed inputs
inputs_schema:
  url:
    type: string
    description: Target URL
  count:
    type: integer
    description: Number of results
  tags:
    type: array
    description: Filter tags
    items:
      type: string
```

Use `inputs_schema: {}` when the skill needs no user-provided parameters.

### 4. Write the Skill Body

The Markdown body after the frontmatter is the agent's instruction set. Follow these guidelines:

- Address the agent directly ("You are a...")
- Structure with clear sections: Setup, Main Flow, Output Format
- Reference primitives by their full name (e.g., `fs.read`, `http.request`)
- Include specific details: CSS selectors for scraping, output formats, error handling
- Keep instructions actionable and step-by-step

### 5. Write Safety Notes

Document what the skill can access and any constraints reviewers should verify:

```yaml
safety_notes: "Read-only workspace access. No network calls."
safety_notes: "Makes HTTP requests. Domain allowlist must include target APIs."
safety_notes: "Writes files to workspace. Shell restricted to safe commands."
```

### 6. Validate and Save

After generating the skill:
1. Save to `examples/skills/<skill-id>.md` (or wherever the user prefers)
2. Remind the user about the lifecycle: Install (quarantined) -> Review -> Approve -> Execute
3. Provide the CLI commands to install and approve:
   ```
   moxxy skill import --agent <id> --name <name> --version <ver> --content "$(cat skill.md)"
   moxxy skill approve --agent <id> --skill <skill-id>
   ```

## Validation Rules

The skill document parser (`SkillDoc::parse`) enforces:
- File must start with `---` (opening frontmatter delimiter)
- Must have closing `---` delimiter
- `id`, `name`, `version` fields are required
- `allowed_primitives` must be a non-empty array
- `version` must be a quoted string in YAML

Common validation errors:
- Unquoted version (`version: 1.0` instead of `version: "1.0"`) = YAML interprets as float
- Empty `allowed_primitives: []` = rejected at parse time
- Missing `id` field = required even though CLI also accepts a name flag

## Additional Resources

### Reference Files

For detailed information, consult:
- **`references/primitives.md`** = Complete list of all 33 primitives with descriptions, parameters, and security notes
- **`references/examples.md`** = Annotated examples of well-structured skills covering common patterns
