# Moxxy Agentic Framework v1 Plan (Greenfield, Rust Core + Node CLI)

## Summary
Build a local-first agentic framework with a Rust control/runtime core and a Node CLI, supporting:
1. Pluggable providers/models (OpenAI, Anthropic, OpenAI-compatible local endpoints) via signed plugin manifests.
2. Skill-first agents using `.md` skills with required metadata and free-form instructions.
3. Strong per-agent isolation (workspace, memory, runtime sandbox, scoped secrets).
4. Sub-agent orchestration with inherited config and bounded fan-out.
5. Heartbeat scheduling checked every minute by gateway cron and executed via per-agent serialized queues.
6. API + CLI as the primary control plane.
7. Secure vault with explicit secret request/grant flow.
8. Full SSE event stream for every action with structured payloads and redaction.
9. External API behind scoped user-generated PATs (interactive CLI wizard + non-interactive flags).

Skill note: no listed meta-skill (`skill-creator`, `skill-installer`) is required for this architecture planning task.

## Architecture (Decision-Complete)
1. `moxxy-core` (Rust): orchestrator, runtime supervisor, scheduler, API server, vault service, plugin host.
2. `moxxy-cli` (Node): interactive UX (opencode-like guided flows) and scriptable commands.
3. `agent-runtime` (Rust process per active agent run): executes model loop, skill invocations, primitives, memory ops, event emission.
4. `plugin-host` (Rust + WASI): loads signed provider plugins and exposes uniform provider/model interface.
5. `gateway` (Rust, REST + SSE): lifecycle API, auth, event subscriptions, heartbeat cron loop.
6. `vault` (Rust service module): key references + policy metadata in SQLite, secret material in OS keychain/secret-service.
7. `storage`: markdown files for human-readable memory + SQLite (`sqlite-vec`) for indexes, embeddings, scheduling, tokens, policies.

## Core Public Interfaces (APIs/Types)
### REST API (OpenAPI-first)
- `POST /v1/auth/tokens` create PAT (scopes, ttl, description).
- `GET /v1/auth/tokens` list PAT metadata.
- `DELETE /v1/auth/tokens/{id}` revoke PAT.
- `GET /v1/providers` list installed provider plugins.
- `GET /v1/providers/{id}/models` list available models.
- `POST /v1/agents` create agent (provider/model, workspace root, policy profile).
- `GET /v1/agents/{id}` get status/config summary.
- `POST /v1/agents/{id}/runs` start run (task/user prompt).
- `POST /v1/agents/{id}/stop` stop active run.
- `POST /v1/agents/{id}/subagents` spawn child agent.
- `GET /v1/agents/{id}/memory/search` semantic + keyword retrieval.
- `POST /v1/agents/{id}/skills/install` install skill (local/URL/generated -> quarantine flow).
- `POST /v1/agents/{id}/skills/approve/{skill_id}` approve quarantined skill.
- `POST /v1/agents/{id}/heartbeats` create/update heartbeat rule.
- `GET /v1/agents/{id}/heartbeats` list rules.
- `POST /v1/vault/secrets` create secret reference.
- `POST /v1/vault/grants` grant agent access to secret ref.
- `GET /v1/events/stream` SSE stream (filtered by agent/run/session).

### SSE Event Contract (emitted for every action)
`EventEnvelope` fields:
- `event_id`, `ts`, `agent_id`, `run_id`, `parent_run_id`, `sequence`, `event_type`, `payload`, `redactions`, `sensitive=false|true`.
Event types:
- `run.started`, `run.completed`, `run.failed`
- `message.delta`, `message.final`
- `model.request`, `model.response`
- `skill.invoked`, `skill.completed`, `skill.failed`
- `primitive.invoked`, `primitive.completed`, `primitive.failed`
- `memory.read`, `memory.write`
- `vault.requested`, `vault.granted`, `vault.denied`
- `heartbeat.triggered`, `heartbeat.completed`, `heartbeat.failed`
- `subagent.spawned`, `subagent.completed`
- `security.violation`, `sandbox.denied`
Message partials use `message.delta` with `payload.prefix` (`assistant`, `tool`, `system`) and ordered `sequence`.

### Key Types
- `AgentConfig`: `provider_id`, `model_id`, `temperature`, `workspace_root`, `core_mount`, `policy_profile`, `max_subagent_depth=2`, `max_subagents_total=8`.
- `SkillDoc`: required frontmatter (`id`, `name`, `version`, `inputs_schema`, `allowed_primitives`, `safety_notes`) + free-form instruction body.
- `HeartbeatRule`: `id`, `interval_minutes`, `action_type`, `action_payload`, `enabled`, `next_run_at`.
- `MemoryRecord`: markdown path, embedding id, tags, timestamps.
- `ApiToken`: hashed token, scopes, ttl, status, created_by.
- `VaultSecretRef`: reference id, backend key id, policy label, audit metadata.

## Security and Isolation Model
1. Filesystem boundary:
- Agent RW only under `~/.moxxy/agents/<agent_id>/workspace`.
- Read-only mount of `~/.moxxy/core` for built-ins/primitives.
- Canonical path checks on every fs primitive; deny symlink escapes and `..` traversal.
2. Process isolation:
- One OS process per active agent run.
- Linux: `bubblewrap`/namespaces + seccomp + cgroup limits.
- macOS: seatbelt profile (`sandbox-exec`) + strict runtime path/network policy enforcement.
3. Capability gating:
- Skills declare needed primitives; runtime enforces allowlist.
- Network egress default deny; per-agent/domain allowlist.
4. Secret handling:
- No raw env inheritance from host.
- Agent requests named secret refs; grant is explicit and auditable.
- Inject secrets only into specific primitive call context, never global process env.
5. Auth:
- PAT scopes: `agents:read`, `agents:write`, `runs:write`, `vault:read`, `vault:write`, `tokens:admin`, `events:read`.
- Token hashing at rest, optional TTL, immediate revoke, audit log.

## Skills and Primitive Layer
### Built-in primitives (composable baseline)
- `fs.read`, `fs.write`, `fs.list`
- `shell.exec` (allowlisted commands, timeout, output caps)
- `http.request` (allowlisted domains, timeout, size limits)
- `memory.search`, `memory.append`, `memory.summarize`
- `notify.webhook`, `notify.cli`
- `skill.import`, `skill.validate`, `skill.install`
### Skill import flow
1. Source accepted from prompt-generated content or URL.
2. Place into quarantine.
3. Validate frontmatter schema + lint safety declarations + primitive scope check.
4. Emit review summary event.
5. Require explicit user/API approval before activation.

## Memory System
1. Canonical memory as markdown journals per agent under `memory/`.
2. Sidecar SQLite index stores metadata, chunk map, and embeddings.
3. Vector search via `sqlite-vec`.
4. Parent and sub-agents have separate memory stores; parent can query child summaries via explicit primitive, not direct file access.
5. Write policy: append-only memory records with periodic compaction summaries.

## Heartbeat and Scheduler
1. Gateway cron ticks every minute.
2. Cron finds due heartbeat rules and enqueues jobs.
3. Per-agent queue concurrency is fixed at 1 to prevent race conditions.
4. Heartbeat actions support:
- status callback to connected CLI sessions
- webhook notify
- execute skill id with payload
5. Agent may update own heartbeat rules through guarded primitive, subject to policy limits (min interval, max actions per hour).

## CLI Control Plane (Node)
1. `moxxy init` bootstrap local directories and services.
2. `moxxy auth token create` interactive wizard (name, scopes, ttl, output format) + `--scopes`, `--ttl`, `--json` flags.
3. `moxxy provider install/list/verify`.
4. `moxxy agent create/run/stop/status`.
5. `moxxy skill import/approve/list`.
6. `moxxy heartbeat set/list/disable`.
7. `moxxy events tail` SSE consumer with filters.
8. `moxxy vault add/grant/revoke/list`.

## Implementation Phases
1. Foundation: repo scaffolding, Rust workspace, Node CLI shell, OpenAPI skeleton, SQLite schema migrations.
2. Runtime core: agent lifecycle, provider abstraction, basic model loop, event bus + SSE.
3. Security hardening: sandbox adapters, path policies, capability enforcement, PAT auth, vault integration.
4. Skill system: markdown schema parser, primitives, import quarantine/approval flow, built-in primitive pack.
5. Orchestration: sub-agent execution model, heartbeat scheduler, notification actions.
6. Reliability: retries, idempotency keys, audit logs, metrics, and failure recovery.
7. Release: CLI UX polish, docs, sample skills, threat model doc, hardening checklist.

## Test Cases and Scenarios
1. Isolation escape attempts: path traversal, symlink escape, forbidden command execution, unauthorized network egress.
2. Provider extension: install signed plugin, reject unsigned/tampered plugin, model enumeration correctness.
3. Skill execution: required metadata validation, free-form instruction parsing, primitive allowlist enforcement.
4. Skill import: URL fetch to quarantine, approval requirement, rejection on schema/policy violation.
5. Memory: markdown write/read integrity, vector retrieval quality, parent-child memory boundaries.
6. Sub-agents: depth/total limits enforced, inherited config correctness, child failure propagation.
7. Heartbeat: minute cron detection, queued execution ordering, missed tick recovery, retry/backoff.
8. Vault: secret request/grant flow, denied access behavior, redaction in events/logs.
9. SSE completeness: every action emits ordered event, message deltas and finals are coherent, redaction works.
10. Auth: PAT scope enforcement, expiry, revocation effect, audit trail correctness.
11. CLI UX: interactive token wizard path and non-interactive flag path both produce equivalent secure output.
12. Cross-platform: macOS and Linux sandbox behavior parity tests.

## Assumptions and Defaults
1. Greenfield implementation in current empty repo.
2. Rust core + Node CLI is mandatory for v1.
3. Local-first single-host deployment for v1 (no multi-tenant distributed control plane initially).
4. macOS + Linux are required targets.
5. API style is REST + SSE with OpenAPI.
6. Provider scope in v1 is OpenAI, Anthropic, and OpenAI-compatible endpoints.
7. Plugin model is signed local plugins with manifest (WASI-hosted adapters).
8. Default sub-agent limits are depth `2`, total children `8` per root run.
9. Memory format is markdown-first with SQLite sidecar + `sqlite-vec`.
10. Heartbeat execution is queued with per-agent concurrency `1`.
11. Skill import default is quarantine + explicit approval.
12. PATs are scoped, revocable, TTL-capable, and generated via interactive CLI wizard or flags.
