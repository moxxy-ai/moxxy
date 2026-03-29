# moxxy-core

Core services and domain logic for the Moxxy agent framework.

## Overview

Provides the foundational services used across the system: authentication, event distribution, agent lifecycle, memory management, skill loading, security enforcement, and scheduled tasks.

## Modules

### auth
- **ApiTokenService** -- issues, validates, and revokes API tokens (`mox_<hex>` format, SHA-256 hashed, scope-based, TTL support)

### agents
- **AgentLineage** -- hierarchical spawn control with depth and total limits
- **AgentRegistry** -- in-memory concurrent agent state (`Arc<RwLock>`) with lookup by name/status/parent
- **AgentStore** -- filesystem CRUD for `agent.yaml` configs, workspace directories, and `persona.md`

### events
- **EventBus** -- tokio broadcast channel for pub/sub event distribution
- **RedactionEngine** -- recursively masks secrets in JSON payloads before emission

### heartbeat
- **HeartbeatScheduler** -- interval and cron-based scheduling with timezone support
- **HeartbeatAction** trait -- pluggable action registry for scheduled callbacks
- **HeartbeatFile** -- markdown+YAML persistence for heartbeat rules

### memory
- **MemoryJournal** -- append-only markdown files with YAML frontmatter and tags
- **MemoryCompactor** -- consolidates old entries by tag, delegates summarization via `CompactionSummarizer` trait
- **EmbeddingService** trait -- pluggable vector embedding provider (384-dim, with mock for tests)

### skills
- **SkillLoader** -- discovers `SKILL.md` files from builtin and agent directories (agent skills override builtins)
- **SkillDoc** -- frontmatter-based metadata (name, description, author, version)

### security
- **PathPolicy** -- workspace-scoped path access control with canonicalization to prevent traversal escapes

### stores
- **TemplateStore**, **WebhookStore**, **ProviderStore**, **ChannelStore**, **AllowlistFile** -- filesystem-backed config stores

## Key Patterns

- **Filesystem as database** -- skills, heartbeats, and memory use markdown+YAML files (human-editable, version-controllable)
- **Trait-based extensibility** -- `EmbeddingService`, `HeartbeatAction`, `CompactionSummarizer` are pluggable
- **Arc+Mutex concurrency** -- `AgentRegistry` and `PathPolicy` cwd are thread-safe

## Dependencies

- `moxxy-types` -- shared type definitions and errors
- `moxxy-storage` -- DAOs for persistent data
- `tokio` -- async runtime and broadcast channels
- `chrono` / `cron` -- scheduling and timezone handling
