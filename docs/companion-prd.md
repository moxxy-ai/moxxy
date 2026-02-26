# Companion Platform - Product Requirements Document

**Version:** 1.0  
**Status:** Draft  
**Last Updated:** February 2025

Companion (by Moxxy) is an autonomous kanban platform that connects to user-hosted moxxy instances to manage projects and tasks through AI agents. The Companion app is built in `../companion-composer`; this PRD lives in the moxxy repo.

---

## 1. Vision & Goals

### Vision
Companion empowers developers and teams to manage software projects autonomously using moxxy agents. Users connect their own moxxy instance (self-hosted or cloud), define projects with kanban-style boards, and let an orchestrator agent batch backlog tasks and delegate work to specialized worker agents (builder, reviewer, etc.).

### Goals
- **Hybrid deployment**: Users connect their own moxxy instance via URL + token; no hosted moxxy required.
- **Kanban-driven workflow**: Projects have boards with columns (e.g., Backlog, In Progress, Review, Done). Tasks move through stages.
- **Autonomous orchestration**: An orchestrator agent batches tasks from the backlog and delegates to worker agents that push code, create PRs, and perform reviews.
- **GitHub integration**: Projects link to GitHub repos; worker agents use bot tokens and commit identities for git operations.
- **Multi-tenant SaaS**: Convex-backed auth and data isolation per user/organization.

---

## 2. User Personas

### Persona 1: Solo Developer
- Runs moxxy locally or on a VPS.
- Wants to offload routine tasks (PR reviews, dependency bumps, small fixes) to agents.
- Connects one moxxy instance, creates projects linked to personal repos.

### Persona 2: Tech Lead / Team Lead
- Manages multiple repositories or a monorepo.
- Uses Companion to triage backlog, assign work to agents, and track progress across projects.
- Needs visibility into agent activity and ability to approve merges.

### Persona 3: Open Source Maintainer
- Runs moxxy to assist with community contributions.
- Uses Companion to queue issues, delegate to builder/reviewer agents, and streamline contribution flow.

---

## 3. Core Features

### 3.1 Authentication

- **Provider**: Convex Auth or Better Auth.
- **Capabilities**:
  - Sign up / sign in with email, OAuth (GitHub, Google).
  - Session management with Convex.
  - Logout and token invalidation.
- **Data**: User identity stored in Convex `users` table; sessions managed by auth provider.

---

### 3.2 moxxy Connection Management

- **Purpose**: Store and validate connectivity to the user's moxxy instance.
- **Capabilities**:
  - Add connection: `base_url` (e.g., `http://localhost:17890`), `internal_token` (for `X-Moxxy-Internal-Token`).
  - Test connection: `GET /api/agents` to verify reachability and auth.
  - Edit/remove connection.
  - One connection per user (or per org in future); primary connection used for all moxxy API calls.
- **Security**: Tokens encrypted at rest in Convex; never exposed to client except during setup.
- **moxxy API used**:
  - `GET /api/agents` — list agents, validate token.

---

### 3.3 Agent Management

- **Purpose**: Create and configure moxxy agents that serve as orchestrator or workers.
- **Capabilities**:
  - List agents: `GET /api/agents` (returns `{ "agents": ["agent1", "agent2", ...] }`).
  - Create agent: `POST /api/agents` with `{ "name", "description" }`. `description` is used as persona (written to `persona.md`).
  - Optional fields: `runtime_type` (`"native"` | `"wasm"`), `image_profile` (`"base"` | `"networked"` | `"full"`).
  - Delete agent: `DELETE /api/agents/{agent}`.
  - Restart agent: `POST /api/agents/{agent}/restart`.
- **Agent definitions in Companion**: Map moxxy agents to roles (orchestrator, builder, reviewer) for use in projects. Stored in Convex `agent_definitions`.

---

### 3.4 Projects

- **Purpose**: Group tasks and link to a GitHub repository.
- **Capabilities**:
  - Create project: name, GitHub repo URL (e.g., `https://github.com/org/repo`).
  - Kanban columns: configurable (default: Backlog, To Do, In Progress, Review, Done).
  - Assign orchestrator agent and worker agents.
  - Archive / delete project.
- **Data**: Stored in Convex `projects` table with `userId`, `repoUrl`, `columns`, `orchestratorAgent`, etc.

---

### 3.5 Tasks

- **Purpose**: Individual work items that move through kanban columns.
- **Capabilities**:
  - Create task: title, description, assign to column.
  - Move task between columns (drag-and-drop).
  - Assign to agent (optional).
  - Sync status from moxxy orchestration jobs (see §5).
  - Link task to moxxy job: store `job_id`, `agent_name` for status polling.
- **Data**: Convex `tasks` table with `projectId`, `column`, `title`, `body`, `moxxyJobId`, `moxxyAgent`, `status`, etc.

---

### 3.6 GitHub Integration

- **Purpose**: Provide worker agents with repo access.
- **Capabilities**:
  - Store GitHub token: `POST /api/agents/{agent}/vault` with `{ "key": "GITHUB_TOKEN", "value": "ghp_..." }`.
  - Bot identity: commit author name/email (stored in project or agent config).
  - Validate token: optional check via GitHub API.
- **moxxy API used**:
  - `POST /api/agents/{agent}/vault` — set `GITHUB_TOKEN` for the agent that performs git operations.

---

### 3.7 Orchestrator

- **Purpose**: Start orchestration jobs on moxxy that batch tasks and delegate to workers.
- **Capabilities**:
  - Configure orchestrator defaults: `GET/POST /api/agents/{agent}/orchestrate/config`.
  - Create/manage templates: `GET/POST/PATCH/DELETE /api/agents/{agent}/orchestrate/templates` and `.../templates/{template_id}`.
  - Start job: `POST /api/agents/{agent}/orchestrate/jobs` with `prompt`, `template_id`, `existing_agents`, `ephemeral`, `max_parallelism`.
  - List jobs: `GET /api/agents/{agent}/orchestrate/jobs?limit=50`.
  - Get job: `GET /api/agents/{agent}/orchestrate/jobs/{job_id}`.
  - List workers: `GET /api/agents/{agent}/orchestrate/jobs/{job_id}/workers`.
  - List events: `GET /api/agents/{agent}/orchestrate/jobs/{job_id}/events?after=0&limit=200`.
  - Stream events: `GET /api/agents/{agent}/orchestrate/jobs/{job_id}/stream` (SSE).
  - Cancel job: `POST /api/agents/{agent}/orchestrate/jobs/{job_id}/cancel`.
  - Approve merge: `POST /api/agents/{agent}/orchestrate/jobs/{job_id}/actions/approve-merge`.

**Job states** (from `JobState`):
`queued`, `planning`, `plugin_pre_dispatch`, `dispatching`, `executing`, `replanning`, `reviewing`, `merge_pending`, `merging`, `completed`, `failed`, `canceled`.

**Start job request body**:
```json
{
  "prompt": "Process backlog tasks for project X",
  "template_id": "tpl-kanban",
  "worker_mode": "existing",
  "existing_agents": ["builder", "reviewer"],
  "ephemeral": { "count": 0 },
  "max_parallelism": 3
}
```

**Worker modes**: `existing`, `ephemeral`, `mixed`.

---

## 4. Data Model — Convex Table Schemas

### 4.1 `users`
Provided by Convex Auth / Better Auth.

| Field        | Type   | Description              |
|-------------|--------|--------------------------|
| `_id`       | Id     | Convex document ID      |
| `email`     | string | User email              |
| `name`      | string | Display name            |
| `image`     | string | Avatar URL (optional)   |
| `createdAt` | number | Timestamp               |

### 4.2 `moxxy_connections`
One per user (or per org later).

| Field          | Type   | Description                                      |
|----------------|--------|--------------------------------------------------|
| `_id`          | Id     | Convex document ID                               |
| `userId`       | Id     | Reference to `users`                             |
| `baseUrl`      | string | moxxy API base (e.g., `http://localhost:17890`)  |
| `internalToken`| string | Encrypted token for `X-Moxxy-Internal-Token`     |
| `createdAt`    | number | Timestamp                                        |
| `updatedAt`    | number | Timestamp                                        |

### 4.3 `agent_definitions`
Maps moxxy agents to Companion roles.

| Field       | Type   | Description                                  |
|------------|--------|----------------------------------------------|
| `_id`      | Id     | Convex document ID                           |
| `userId`   | Id     | Reference to `users`                         |
| `agentName`| string | moxxy agent name                             |
| `role`     | string | `"orchestrator"` \| `"builder"` \| `"reviewer"` \| `"generic"` |
| `persona`  | string | Short description / capability               |
| `createdAt`| number | Timestamp                                    |
| `updatedAt`| number | Timestamp                                    |

### 4.4 `projects`

| Field             | Type     | Description                                      |
|-------------------|----------|--------------------------------------------------|
| `_id`             | Id       | Convex document ID                               |
| `userId`          | Id       | Reference to `users`                             |
| `name`            | string   | Project name                                     |
| `repoUrl`         | string   | GitHub repo URL                                  |
| `columns`         | string[] | Kanban column IDs, e.g. `["backlog","todo","in_progress","review","done"]` |
| `orchestratorAgent`| string  | moxxy agent name for orchestrator                |
| `workerAgents`    | string[] | moxxy agent names for workers                    |
| `templateId`      | string?  | Optional orchestrator template_id               |
| `createdAt`       | number   | Timestamp                                        |
| `updatedAt`       | number   | Timestamp                                        |

### 4.5 `tasks`

| Field         | Type   | Description                                    |
|---------------|--------|------------------------------------------------|
| `_id`         | Id     | Convex document ID                             |
| `projectId`   | Id     | Reference to `projects`                        |
| `title`       | string | Task title                                     |
| `body`        | string | Task description                               |
| `column`      | string | Current kanban column ID                       |
| `position`    | number | Order within column                            |
| `moxxyJobId`  | string?| Linked moxxy orchestration job_id              |
| `moxxyAgent`  | string?| moxxy agent that owns the job                  |
| `status`      | string | Synced status: `idle`, `queued`, `planning`, `dispatching`, `executing`, `completed`, `failed`, `canceled` |
| `createdAt`   | number | Timestamp                                      |
| `updatedAt`   | number | Timestamp                                      |

### 4.6 Indexes
- `moxxy_connections`: by `userId` (unique per user).
- `agent_definitions`: by `userId`, by `(userId, agentName)`.
- `projects`: by `userId`.
- `tasks`: by `projectId`, by `(projectId, column)`.

---

## 5. moxxy Integration Flow

### 5.1 Connection Flow

1. User enters moxxy `base_url` and `internal_token`.
2. Companion (Convex Action) calls `GET {base_url}/api/agents` with `X-Moxxy-Internal-Token: {token}`.
3. On success: store connection in `moxxy_connections`. On failure: return error, do not store.
4. All subsequent moxxy calls use stored connection; Convex Action proxies requests to avoid exposing token to client.

### 5.2 Job Lifecycle

1. **Create job**: User selects backlog tasks, clicks "Start orchestration".
2. Companion builds `prompt` from task titles/descriptions (e.g., "Process these tasks: 1. Fix login bug 2. Update deps").
3. Convex Action calls `POST /api/agents/{orchestrator}/orchestrate/jobs` with:
   - `prompt`, `template_id`, `existing_agents` (worker agent names), `worker_mode`, etc.
4. moxxy returns `{ "success": true, "job_id": "...", "worker_count": N }`.
5. Companion stores `job_id` and `agent_name` on the linked task(s) and sets `status` to `queued`.
6. **Polling or SSE**: Companion subscribes to job events via `GET .../jobs/{id}/stream` (SSE) or polls `GET .../jobs/{id}` and `.../events`.
7. On `type: "done"` or `status: "completed" | "failed" | "canceled"`, update task `status` accordingly.
8. User can cancel via `POST .../jobs/{id}/cancel` or approve merge via `POST .../jobs/{id}/actions/approve-merge`.

### 5.3 Task Sync

| Companion Task Status | moxxy Job Status        |
|-----------------------|-------------------------|
| `idle`                | No linked job           |
| `queued`              | `queued`                |
| `planning`            | `planning`              |
| `dispatching`         | `dispatching`           |
| `executing`           | `executing`, `replanning`, etc. |
| `completed`           | `completed`             |
| `failed`              | `failed`                |
| `canceled`             | `canceled`               |

Sync is driven by Convex cron or real-time SSE subscription. When job status changes, Companion updates the linked task(s).

---

## 6. Technical Stack

| Layer        | Technology                                      |
|--------------|--------------------------------------------------|
| Build        | Vite                                            |
| UI           | React 19                                        |
| Backend      | Convex (serverless functions, database, auth)   |
| Data Fetching| Convex React hooks for Convex data; React Query for moxxy API calls (via Convex Actions) |
| Styling      | Tailwind CSS (or project default)               |

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│ Companion App (Vite + React + Convex)                            │
│  ┌──────────┐  ┌──────────────┐  ┌──────────────┐               │
│  │ Auth     │  │ Convex DB    │  │ Convex Cron  │               │
│  │ (Convex) │  │ (users,      │  │ Jobs         │               │
│  │          │  │  projects,   │  │              │               │
│  │          │  │  tasks, etc)│  │              │               │
│  └────┬─────┘  └──────────────┘  └──────┬───────┘               │
│       │                                 │                        │
│       └─────────────────────────────────┘                        │
│                         │                                        │
│                         ▼                                        │
│              ┌──────────────────────┐                            │
│              │ Convex Actions       │                            │
│              │ (HTTP proxy to moxxy)│                            │
│              └──────────┬───────────┘                            │
└─────────────────────────┼───────────────────────────────────────┘
                          │
                          │ X-Moxxy-Internal-Token
                          │ POST/GET /api/agents/.../orchestrate/...
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│ User's moxxy Instance (Port 17890)                                │
│  ┌─────────────────┐  ┌─────────────────────────────────────┐  │
│  │ moxxy API       │  │ Orchestrator Agent → Worker Agents    │  │
│  │ (agents, vault, │  │ (builder, reviewer, etc.)             │  │
│  │  orchestrate)   │  │ → git push, PRs, reviews               │  │
│  └────────┬────────┘  └────────────────────┬──────────────────┘  │
└───────────┼────────────────────────────────┼─────────────────────┘
            │                                │
            └────────────────────────────────┘
                             │
                             ▼
                    ┌────────────────┐
                    │ GitHub (Repo)  │
                    └────────────────┘
```

### moxxy API Summary (Companion-Relevant)

| Companion Need                    | moxxy API                                                                 |
|-----------------------------------|---------------------------------------------------------------------------|
| List agents                        | `GET /api/agents` → `{ "agents": [...] }`                                |
| Create agent                      | `POST /api/agents` → `{ "name", "description" }`                         |
| Store GitHub token                | `POST /api/agents/{agent}/vault` → `{ "key": "GITHUB_TOKEN", "value" }`  |
| Get/Set orchestrator config        | `GET/POST /api/agents/{agent}/orchestrate/config`                        |
| List/Create templates             | `GET/POST /api/agents/{agent}/orchestrate/templates`                     |
| Start orchestration job           | `POST /api/agents/{agent}/orchestrate/jobs`                             |
| List jobs                         | `GET /api/agents/{agent}/orchestrate/jobs?limit=50`                      |
| Get job, workers, events          | `GET .../jobs/{id}`, `.../workers`, `.../events?after=&limit=`           |
| Stream job events (SSE)           | `GET .../jobs/{id}/stream`                                               |
| Cancel job                        | `POST .../jobs/{id}/cancel`                                              |
| Approve merge                     | `POST .../jobs/{id}/actions/approve-merge`                                |
| Delegate to specific agent        | `POST /api/agents/{agent}/delegate` (plain text body)                    |

All moxxy endpoints require `X-Moxxy-Internal-Token` header. Base URL default: `http://127.0.0.1:17890` (see `docs/api-reference.md`).

---

## 7. Non-Goals & Future Scope

### Non-Goals (v1)
- Hosted moxxy: Users must run their own moxxy instance.
- Real-time collaboration: No multi-user editing of the same board simultaneously.
- Slack/Discord/Telegram bots: Focus on web UI + GitHub.
- Custom LLM provider config from Companion: Users configure providers in moxxy.
- Multi-org / team workspaces: Single user per connection.

### Future Scope
- **Organizations**: Shared workspaces, team connections.
- **Webhooks**: moxxy webhooks to push events back to Companion.
- **More channels**: Slack/Discord integration for notifications.
- **Hosted moxxy option**: Optional managed moxxy for users who prefer not to self-host.
- **Multiple connections**: Per-project moxxy instance selection.
- **Metrics & billing**: Usage tracking, agent run metrics.

---

## 8. Implementation Phases

### Phase 1: Foundation (Weeks 1–2)
- [ ] Convex project + Vite + React setup in `companion-composer`.
- [ ] Auth: Convex Auth or Better Auth with GitHub OAuth.
- [ ] Convex schema: `users`, `moxxy_connections`, `agent_definitions`, `projects`, `tasks`.
- [ ] Connection flow: add connection, test via Convex Action calling `GET /api/agents`.
- [ ] Basic dashboard: list projects, empty state.

### Phase 2: Projects & Tasks (Weeks 3–4)
- [ ] CRUD for projects (name, repo URL, columns).
- [ ] CRUD for tasks (title, body, column, position).
- [ ] Kanban board UI with drag-and-drop.
- [ ] Agent definitions: list moxxy agents, assign roles.

### Phase 3: Orchestrator Integration (Weeks 5–6)
- [ ] Convex Action: proxy moxxy orchestrate endpoints.
- [ ] Start job flow: select tasks → build prompt → POST `/orchestrate/jobs`.
- [ ] Job status polling or SSE subscription.
- [ ] Task status sync from job lifecycle.
- [ ] Cancel job, approve merge actions.

### Phase 4: GitHub & Polish (Weeks 7–8)
- [ ] GitHub token storage via vault API.
- [ ] Bot identity (commit author) in project settings.
- [ ] Error handling, loading states, empty states.
- [ ] Responsive layout, accessibility.
- [ ] Documentation for users.

---

## Appendix A: moxxy Orchestration Types Reference

From `src/core/orchestrator/types.rs`:

- **JobState**: `queued`, `planning`, `plugin_pre_dispatch`, `dispatching`, `executing`, `replanning`, `reviewing`, `merge_pending`, `merging`, `completed`, `failed`, `canceled`
- **WorkerMode**: `existing`, `ephemeral`, `mixed`
- **JobFailurePolicy**: `auto_replan`, `fail_fast`, `best_effort`
- **JobMergePolicy**: `manual_approval`, `auto_on_review_pass`
- **SpawnProfile**: `role`, `persona`, `provider`, `model`, `runtime_type`, `image_profile`
- **OrchestratorTemplate**: `template_id`, `name`, `description`, `spawn_profiles`, optional defaults for worker_mode, max_parallelism, retry_limit, failure_policy, merge_policy
- **OrchestratorAgentConfig**: `default_template_id`, `default_worker_mode`, `default_max_parallelism`, `default_retry_limit`, `default_failure_policy`, `default_merge_policy`, `parallelism_warn_threshold`

---

## Appendix B: Related moxxy Sources

- `docs/api-reference.md` — Full moxxy API reference
- `src/interfaces/web/handlers/orchestrate.rs` — Orchestration job handlers
- `src/interfaces/web/handlers/orchestrator_config.rs` — Config handlers
- `src/interfaces/web/handlers/orchestrator_templates.rs` — Template handlers
- `src/core/orchestrator/types.rs` — JobState, SpawnProfile, OrchestratorTemplate, etc.
- `src/core/memory/types.rs` — OrchestratorJobRecord, OrchestratorWorkerRunRecord, OrchestratorEventRecord
