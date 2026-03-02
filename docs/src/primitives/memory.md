# Memory Primitives

Memory primitives give agents persistent storage for notes, findings, and context that survives across runs. Memory supports tagging, full-text search, vector-based semantic search, and automatic compaction.

## memory.append

Write a timestamped Markdown entry to the agent's memory journal.

**Parameters**:

```json
{
  "content": "## Finding: Auth module uses deprecated bcrypt version\n\nThe auth module...",
  "tags": ["security", "auth", "finding"]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `content` | string | Yes | Markdown content to store |
| `tags` | string[] | No | Tags for categorization and filtering |

**Result**:

```json
{
  "id": "019cac18-...",
  "path": "/home/user/.moxxy/agents/019cac12/memory/2026-03-02T12-00-00.md",
  "tags": ["security", "auth", "finding"]
}
```

Each memory entry is stored as:
1. A Markdown file on disk in the agent's memory directory
2. A row in the `memory_index` table with tags and metadata
3. An embedding vector in the `memory_vec0` virtual table (for semantic search)

**Events emitted**: `memory.write`

## memory.search

Search memory entries by content or semantic similarity.

**Parameters**:

```json
{
  "query": "authentication security",
  "limit": 10
}
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `query` | string | Yes | -- | Search query |
| `limit` | integer | No | 10 | Maximum results to return |

**Result**:

```json
{
  "results": [
    {
      "id": "019cac18-...",
      "content": "## Finding: Auth module uses deprecated bcrypt...",
      "tags": ["security", "auth"],
      "created_at": "2026-03-02T12:00:00Z",
      "score": 0.87
    }
  ],
  "total": 1
}
```

Search operates in two modes:
- **Substring search**: Case-insensitive content matching (always available)
- **Vector search**: Semantic similarity using 384-dimension embeddings via `sqlite-vec` (when embeddings are available)

**Events emitted**: `memory.read`

## memory.summarize

Generate a summary of the agent's memory contents.

**Parameters**:

```json
{}
```

**Result**:

```json
{
  "total_entries": 42,
  "tags": {
    "security": 8,
    "auth": 5,
    "finding": 12,
    "refactoring": 7
  },
  "oldest": "2026-02-15T10:00:00Z",
  "newest": "2026-03-02T12:00:00Z"
}
```

## Vector Search

Moxxy uses `sqlite-vec` for semantic memory retrieval:

1. When a memory entry is appended, the `EmbeddingService` generates a 384-dimension float vector
2. The vector is stored in a `memory_vec0` virtual table
3. Search queries are also embedded and compared using cosine similarity
4. Results are ranked by similarity score

The vector table is defined as:

```sql
CREATE VIRTUAL TABLE memory_vec0 USING vec0(
    memory_id TEXT,
    embedding float[384]
);
```

## Memory Compaction

Over time, agents accumulate many memory entries. The `MemoryCompactor` can consolidate old entries:

1. Identify eligible entries (based on age and count thresholds)
2. Group entries by tags
3. Generate summaries using the `CompactionSummarizer`
4. Replace original entries with compact summaries
5. Update embeddings for the new summaries

Compaction can be triggered:
- Manually via the API
- Automatically via a heartbeat rule with `action_type: "memory_compact"`

**Events**: `memory.compact_started`, `memory.compact_completed`

### Compaction Configuration

```rust
pub struct CompactionConfig {
    pub min_age_hours: u64,      // Minimum age for eligible entries
    pub min_entries: usize,      // Minimum entries before compaction
    pub group_by_tags: bool,     // Group by tags when summarizing
}
```

## Database Schema

```sql
CREATE TABLE memory_index (
    id TEXT PRIMARY KEY NOT NULL,
    agent_id TEXT NOT NULL,
    markdown_path TEXT NOT NULL,
    tags_json TEXT,
    chunk_hash TEXT,
    embedding_id TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
);
```

## Example Skill Declaration

```yaml
allowed_primitives:
  - memory.append
  - memory.search
  - memory.summarize
  - fs.read
safety_notes: "Memory access for recording and retrieving findings."
```
