//! End-to-end integration tests for the post-run reflection pipeline.
//!
//! These tests spin up a real `RunExecutor` with a scripted provider that
//! returns different responses depending on which stage of the run is
//! calling it. We then assert that every downstream artifact the reflection
//! pass is supposed to produce actually lands on disk / in SQLite:
//!
//!  - journal entry with YAML frontmatter
//!  - LTM row with `lesson` tag and an embedding
//!  - FTS5 session summary row matching the canned summary
//!  - per-user profile patched at `users/<id>.md`
//!  - quarantined skill at `skills_quarantine/<slug>/SKILL.md` with provenance frontmatter

use async_trait::async_trait;
use moxxy_core::{EventBus, MockEmbeddingService};
use moxxy_runtime::provider::{Message, ModelConfig, Provider, ProviderResponse, ToolChoice};
use moxxy_runtime::registry::{PrimitiveError, PrimitiveRegistry, ToolDefinition};
use moxxy_runtime::{ReflectionContext, RunExecutor};
use moxxy_storage::Database;
use moxxy_test_utils::TestDb;
use moxxy_types::agents::ReflectionConfig;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, RwLock};

const CANNED_REFLECTION_JSON: &str = r##"{
  "what_worked": ["fetched the PDF via browse.fetch", "extracted three bullets from the report"],
  "what_failed": [],
  "lessons": [
    {"text": "Prefer direct URL when the report is public", "tags": ["research"]},
    {"text": "Always summarize into markdown bullets", "tags": ["formatting"]}
  ],
  "reusable": true,
  "reusable_reason": "Multi-step research flow that recurs across quarterly-report tasks and is worth saving.",
  "skill_draft": {
    "name": "Quarterly Report Fetcher",
    "description": "Fetches and summarizes publicly available quarterly reports into markdown bullets",
    "allowed_primitives": ["browse.fetch", "memory.store"],
    "body_markdown": "# Instructions\n1. Use browse.fetch on the URL\n2. Extract key figures\n3. Emit a markdown summary"
  },
  "user_profile_patch": {
    "replace_body": "# User\nPrefers terse bulleted summaries.\nDomain: quarterly financial reports."
  },
  "session_summary": "Fetched the Q1 report and summarized it into three bullets for the user."
}"##;

/// Provider that returns empty tool_calls + a canned final message on the
/// main-run call, and returns the canned ReflectionOutput JSON when invoked
/// for the reflection stage (detected by prompt prefix).
struct ScriptedProvider {
    calls: Arc<AtomicUsize>,
}

impl ScriptedProvider {
    fn new() -> (Self, Arc<AtomicUsize>) {
        let calls = Arc::new(AtomicUsize::new(0));
        (
            Self {
                calls: calls.clone(),
            },
            calls,
        )
    }
}

#[async_trait]
impl Provider for ScriptedProvider {
    async fn complete(
        &self,
        messages: Vec<Message>,
        _config: &ModelConfig,
        _tools: &[ToolDefinition],
    ) -> Result<ProviderResponse, PrimitiveError> {
        self.calls.fetch_add(1, Ordering::SeqCst);

        // The reflection stage uses a single user message that starts with the
        // canonical prefix. We detect it and return the canned JSON.
        let last_user = messages
            .iter()
            .rev()
            .find(|m| m.role == "user")
            .map(|m| m.content.clone())
            .unwrap_or_default();
        let is_reflection = last_user.contains("You are the reflection stage for agent");

        let content = if is_reflection {
            CANNED_REFLECTION_JSON.to_string()
        } else {
            "Here are the three bullets from the Q1 report.".to_string()
        };

        Ok(ProviderResponse {
            content,
            tool_calls: vec![],
            usage: None,
        })
    }
}

fn sample_config() -> ReflectionConfig {
    ReflectionConfig {
        enabled: true,
        skill_synthesis_enabled: true,
        user_profiles_enabled: true,
        min_tool_calls_for_skill: 0, // allow skill synthesis without real tool calls in this fake run
        journal_max_bytes: 5_000_000,
        timeout_secs: 30,
        skill_history_max_versions: 10,
    }
}

fn setup_context(
    agent_dir: &std::path::Path,
    moxxy_home: &std::path::Path,
    user_id: Option<String>,
) -> (ReflectionContext, Arc<Mutex<Database>>) {
    let tdb = TestDb::new();
    tdb.run_migrations();
    let conn = tdb.into_conn();
    // memory_index.agent_id has a FK to agents(id); seed the row so lesson
    // inserts don't trip the constraint.
    conn.execute(
        "INSERT INTO agents (id, name, status, workspace_root, created_at, updated_at) \
         VALUES ('alice', 'alice', 'idle', '/tmp/alice', datetime('now'), datetime('now'))",
        [],
    )
    .unwrap();
    let db: Arc<Mutex<Database>> = Arc::new(Mutex::new(Database::new(conn)));

    let ctx = ReflectionContext {
        db: db.clone(),
        embedding_svc: Arc::new(MockEmbeddingService::new()),
        agent_dir: agent_dir.to_path_buf(),
        moxxy_home: moxxy_home.to_path_buf(),
        config: sample_config(),
        user_id,
        channel_id: None,
        agent_name: "alice".into(),
        run_starter: None,
    };
    (ctx, db)
}

#[tokio::test]
async fn reflection_e2e_writes_journal_ltm_fts_profile_and_quarantined_skill() {
    let tmp = tempfile::TempDir::new().unwrap();
    let agent_dir = tmp.path().join("agents").join("alice");
    std::fs::create_dir_all(&agent_dir).unwrap();

    let (ctx, db) = setup_context(&agent_dir, tmp.path(), Some("tg:42".into()));

    let (provider, call_count) = ScriptedProvider::new();
    let provider: Arc<dyn Provider> = Arc::new(provider);
    let event_bus = EventBus::new(256);

    let registry = PrimitiveRegistry::new();
    let allowed = Arc::new(RwLock::new(Vec::<String>::new()));

    let mut executor =
        RunExecutor::new(event_bus, provider, registry, allowed).with_reflection(ctx);

    let model_config = ModelConfig {
        temperature: 0.7,
        max_tokens: 2048,
        tool_choice: ToolChoice::Auto,
    };

    let result = executor
        .execute(
            "alice",
            "run-e2e-1",
            "summarize the Q1 report",
            &model_config,
        )
        .await;
    assert!(result.is_ok(), "execute returned Err: {:?}", result);

    // Two provider calls: one for the main run (no tool calls, completes),
    // one for the reflection pass. If reflection didn't fire, count stays 1.
    assert_eq!(call_count.load(Ordering::SeqCst), 2);

    // Journal entry written with expected frontmatter fields.
    let journal =
        std::fs::read_to_string(agent_dir.join("journal.md")).expect("journal.md should exist");
    assert!(journal.contains("run_id: run-e2e-1"));
    assert!(journal.contains("agent: alice"));
    assert!(journal.contains("outcome: success"));
    assert!(journal.contains("Prefer direct URL when the report is public"));

    // LTM rows: one per lesson, all tagged `lesson` + `reflection` + `run:run-e2e-1`.
    let conn = db.lock().unwrap();
    let count: i64 = conn
        .conn()
        .query_row(
            "SELECT COUNT(*) FROM memory_index WHERE agent_id = ?1 AND tags_json LIKE '%\"lesson\"%'",
            [&"alice"],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(count, 2, "expected 2 lessons in LTM, got {count}");

    // FTS5 session summary row exists and matches the canned summary.
    let summary: String = conn
        .conn()
        .query_row(
            "SELECT summary FROM session_summary WHERE run_id = ?1",
            [&"run-e2e-1"],
            |r| r.get(0),
        )
        .unwrap();
    assert!(summary.contains("Q1 report"));
    drop(conn);

    // User profile patched at users/tg:42.md.
    let profile = std::fs::read_to_string(agent_dir.join("users").join("tg:42.md")).unwrap();
    assert!(profile.contains("Prefers terse bulleted summaries"));

    // Quarantined skill materialized with provenance frontmatter.
    let quarantine_dir = agent_dir.join("skills_quarantine");
    let entries: Vec<_> = std::fs::read_dir(&quarantine_dir)
        .expect("skills_quarantine should exist")
        .flatten()
        .collect();
    assert_eq!(entries.len(), 1, "expected one quarantined skill");
    let skill_md = entries[0].path().join("SKILL.md");
    let skill_body = std::fs::read_to_string(&skill_md).unwrap();
    assert!(skill_body.contains("author: auto-synthesized:alice"));
    assert!(skill_body.contains("source_run_id: run-e2e-1"));
    assert!(skill_body.contains("status: quarantined"));
    assert!(skill_body.contains("Quarterly Report Fetcher"));

    // NOT in the active tool catalog.
    assert!(
        !agent_dir.join("skills").exists() || {
            let entries: Vec<_> = std::fs::read_dir(agent_dir.join("skills"))
                .unwrap()
                .flatten()
                .collect();
            entries.is_empty()
        }
    );
}

#[tokio::test]
async fn reflection_e2e_failed_run_extracts_lessons_but_no_skill() {
    // A provider that returns an error from complete() — this triggers the
    // Failed-run reflection path. The reflection stage itself still succeeds
    // (a different provider call) and returns the canned output, but the
    // skill draft should be dropped because outcome != Success.
    struct FailingProvider {
        calls: Arc<AtomicUsize>,
    }
    #[async_trait]
    impl Provider for FailingProvider {
        async fn complete(
            &self,
            messages: Vec<Message>,
            _config: &ModelConfig,
            _tools: &[ToolDefinition],
        ) -> Result<ProviderResponse, PrimitiveError> {
            let n = self.calls.fetch_add(1, Ordering::SeqCst);
            let last = messages
                .iter()
                .rev()
                .find(|m| m.role == "user")
                .map(|m| m.content.clone())
                .unwrap_or_default();
            if last.contains("You are the reflection stage") {
                return Ok(ProviderResponse {
                    content: CANNED_REFLECTION_JSON.to_string(),
                    tool_calls: vec![],
                    usage: None,
                });
            }
            // First main-run call fails hard.
            if n == 0 {
                return Err(PrimitiveError::ExecutionFailed("boom".into()));
            }
            // Subsequent calls shouldn't happen in this test.
            Ok(ProviderResponse {
                content: "unexpected".into(),
                tool_calls: vec![],
                usage: None,
            })
        }
    }

    let tmp = tempfile::TempDir::new().unwrap();
    let agent_dir = tmp.path().join("agents").join("alice");
    std::fs::create_dir_all(&agent_dir).unwrap();
    let (ctx, db) = setup_context(&agent_dir, tmp.path(), None);

    let calls = Arc::new(AtomicUsize::new(0));
    let provider: Arc<dyn Provider> = Arc::new(FailingProvider {
        calls: calls.clone(),
    });
    let event_bus = EventBus::new(256);
    let registry = PrimitiveRegistry::new();
    let allowed = Arc::new(RwLock::new(Vec::<String>::new()));

    let mut executor =
        RunExecutor::new(event_bus, provider, registry, allowed).with_reflection(ctx);

    let model_config = ModelConfig {
        temperature: 0.7,
        max_tokens: 2048,
        tool_choice: ToolChoice::Auto,
    };

    let result = executor
        .execute("alice", "run-fail-1", "try a thing", &model_config)
        .await;
    assert!(result.is_err(), "expected failure, got {:?}", result);

    // Journal entry must record the failure outcome.
    let journal =
        std::fs::read_to_string(agent_dir.join("journal.md")).expect("journal.md should exist");
    assert!(journal.contains("outcome: failed"));

    // No quarantined skill: failed runs can't synthesize.
    let quarantine = agent_dir.join("skills_quarantine");
    if quarantine.exists() {
        let entries: Vec<_> = std::fs::read_dir(&quarantine).unwrap().flatten().collect();
        assert!(entries.is_empty(), "failed run must not synthesize a skill");
    }

    // Lessons should still be stored — failure reflection's whole point.
    let conn = db.lock().unwrap();
    let count: i64 = conn
        .conn()
        .query_row(
            "SELECT COUNT(*) FROM memory_index WHERE agent_id = ?1 AND tags_json LIKE '%\"lesson\"%'",
            [&"alice"],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(count, 2, "lessons should persist on failed-run reflection");
}

#[tokio::test]
async fn reflection_disabled_emits_no_journal_or_ltm() {
    let tmp = tempfile::TempDir::new().unwrap();
    let agent_dir = tmp.path().join("agents").join("alice");
    std::fs::create_dir_all(&agent_dir).unwrap();

    // Context exists but config.enabled = false.
    let tdb = TestDb::new();
    tdb.run_migrations();
    let conn = tdb.into_conn();
    conn.execute(
        "INSERT INTO agents (id, name, status, workspace_root, created_at, updated_at) \
         VALUES ('alice', 'alice', 'idle', '/tmp/alice', datetime('now'), datetime('now'))",
        [],
    )
    .unwrap();
    let db: Arc<Mutex<Database>> = Arc::new(Mutex::new(Database::new(conn)));
    let mut cfg = sample_config();
    cfg.enabled = false;
    let ctx = ReflectionContext {
        db: db.clone(),
        embedding_svc: Arc::new(MockEmbeddingService::new()),
        agent_dir: agent_dir.clone(),
        moxxy_home: tmp.path().to_path_buf(),
        config: cfg,
        user_id: Some("tg:1".into()),
        channel_id: None,
        agent_name: "alice".into(),
        run_starter: None,
    };

    let (provider, call_count) = ScriptedProvider::new();
    let provider: Arc<dyn Provider> = Arc::new(provider);
    let event_bus = EventBus::new(256);
    let registry = PrimitiveRegistry::new();
    let allowed = Arc::new(RwLock::new(Vec::<String>::new()));

    let mut executor =
        RunExecutor::new(event_bus, provider, registry, allowed).with_reflection(ctx);

    let model_config = ModelConfig {
        temperature: 0.7,
        max_tokens: 2048,
        tool_choice: ToolChoice::Auto,
    };

    let _ = executor
        .execute("alice", "run-off-1", "task", &model_config)
        .await
        .unwrap();

    // Only the main-run provider call should have fired.
    assert_eq!(call_count.load(Ordering::SeqCst), 1);
    // No journal, no lessons, no profile, no quarantined skill.
    assert!(!agent_dir.join("journal.md").exists());
    assert!(!agent_dir.join("users").exists());
    assert!(!agent_dir.join("skills_quarantine").exists());
    let conn = db.lock().unwrap();
    let count: i64 = conn
        .conn()
        .query_row(
            "SELECT COUNT(*) FROM memory_index WHERE agent_id = ?1",
            [&"alice"],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(count, 0);
}
