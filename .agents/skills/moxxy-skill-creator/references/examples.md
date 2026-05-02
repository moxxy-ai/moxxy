# Moxxy Skill Examples

Annotated examples of well-structured skills. Use these as templates when creating new skills.

## Example 1: Code Review (Read-Only Analysis)

A minimal skill that only reads files. Good template for analysis/audit tasks.

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

# Code Review Skill

You are a code review assistant. Analyze code for bugs, style issues, and improvements.

## Steps

1. **Discover files** using `fs.list` to understand the project structure
2. **Read source files** using `fs.read` for each file to review
3. **Analyze** for common issues: bugs, security flaws, style violations, missing tests
4. **Log findings** using `memory.append` with tags `["review", "finding"]`

## Output Format

For each finding, report:
- File and line range
- Severity (critical / warning / suggestion)
- Description of the issue
- Suggested fix
```

**Key patterns**: empty `inputs_schema`, read-only primitives, structured output format.

---

## Example 2: API Monitor (Scheduled Task with Alerts)

A skill that uses heartbeats for recurring execution and webhooks for alerting.

```markdown
---
id: api-monitor
name: API Monitor
version: "1.0"
inputs_schema:
  url:
    type: string
    description: URL to monitor
  interval:
    type: integer
    description: Check interval in minutes (default 5)
  alert_webhook:
    type: string
    description: Webhook URL for failure alerts
allowed_primitives:
  - http.request
  - heartbeat.create
  - heartbeat.list
  - heartbeat.disable
  - heartbeat.delete
  - webhook.create
  - webhook.list
  - notify.webhook
  - notify.cli
  - memory.append
  - memory.search
safety_notes: "Makes HTTP requests to monitored URLs and alert webhooks. Domain allowlist must include both."
---

# API Monitor Skill

You are an uptime monitoring assistant. Set up health checks and alert on failures.

## Setup Flow

1. **Create alert webhook** using `webhook.create`
2. **Create heartbeat** using `heartbeat.create` with `action_type: "execute_skill"`
3. **Confirm setup** = return heartbeat ID and next check time

## Check Flow (on each heartbeat trigger)

1. **Ping endpoint** using `http.request` with GET
2. **Evaluate response** = check status code and response time
3. **On failure**: alert via `notify.webhook`, log via `memory.append`
4. **On success**: log recovery if previous was failure
```

**Key patterns**: typed `inputs_schema`, heartbeat scheduling, webhook notifications, separate setup vs execution flows.

---

## Example 3: Project Scaffold (File Generation + Git)

A skill that creates files and initializes a git repository.

```markdown
---
id: project-scaffold
name: Project Scaffold
version: "1.0"
inputs_schema:
  framework:
    type: string
    description: Framework to use (e.g. "vite-react", "next", "express")
  name:
    type: string
    description: Project name
  features:
    type: string
    description: Comma-separated list of features
allowed_primitives:
  - fs.write
  - fs.list
  - fs.read
  - shell.exec
  - git.init
  - git.commit
  - memory.append
safety_notes: "Writes files to workspace. Shell restricted to ls/cat/grep/find/echo/wc. No network access."
---

# Project Scaffold Skill

You are a project scaffolding assistant. Create complete, production-ready project structures.

## Steps

1. **Check workspace** using `fs.list`
2. **Create project files** using `fs.write` for each file
3. **Initialize git** using `git.init`
4. **Write .gitignore** using `fs.write`
5. **Commit scaffold** using `git.commit`
6. **Log to memory** using `memory.append` with project metadata
```

**Key patterns**: multiple input parameters, fs + git combination, no network access.

---

## Example 4: Web Researcher (Browse + Memory)

A skill that fetches web pages and stores findings.

```markdown
---
id: web-researcher
name: Web Researcher
version: "1.0"
inputs_schema:
  query:
    type: string
    description: Research topic or question
  sources:
    type: array
    description: URLs to research
    items:
      type: string
allowed_primitives:
  - browse.fetch
  - browse.extract
  - memory.append
safety_notes: "Fetches external web pages. Domain allowlist must include target sites."
---

# Web Researcher Skill

You are a research assistant. Gather and synthesize information from web sources.

## Research Flow

1. **Fetch pages** using `browse.fetch` with CSS selectors for article content
2. **Extract details** using `browse.extract` for deeper parsing
3. **Synthesize findings** = identify key points, contradictions, gaps
4. **Store results** using `memory.append` with tags `["research", "{topic}"]`

## Output Format

- **Summary**: 2-3 paragraph overview
- **Key Findings**: Bulleted list with source attribution
- **Gaps**: Areas needing further research
```

**Key patterns**: array inputs, browse primitives with CSS selectors, structured research output.

---

## Anti-Patterns to Avoid

### Over-permissioning
Bad: granting `git.push`, `git.pr_create` to a code review skill that only reads.

### Missing safety_notes
Bad: `safety_notes: ""` = always document what the skill accesses.

### Unquoted version
Bad: `version: 1.0` = YAML interprets as float 1.0, not string "1.0".
Always: `version: "1.0"`

### Vague instructions
Bad: "Do something useful with the files."
Good: Step-by-step flow referencing specific primitives by name.

### Empty allowed_primitives
Bad: `allowed_primitives: []` = will fail validation.
Every skill must declare at least one primitive.
