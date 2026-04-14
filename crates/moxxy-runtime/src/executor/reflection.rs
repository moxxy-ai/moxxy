//! Post-run reflection pass.
//!
//! After a successful run completes, the reflection pass asks the model one
//! more question — "what worked, what failed, what's worth remembering?" —
//! and persists the answer as:
//!
//! * a timestamped entry appended to `<agent_dir>/journal.md`
//! * one LTM row per lesson (tagged `lesson` + `reflection` + `run:<id>`)
//! * optional per-end-user profile patch at `<agent_dir>/users/<user_id>.md`
//!
//! The pass is opt-in via `AgentConfig.reflection.enabled`. When disabled the
//! executor skips it entirely. Skill synthesis (`skill_draft` field in
//! the output) is parsed here but acting on it is deferred to a later PR.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use moxxy_core::{EmbeddingService, SkillDoc, SkillLoader, embedding_to_bytes};
use moxxy_storage::Database;
use moxxy_types::RunStarter;
use moxxy_types::agents::ReflectionConfig;
use serde::{Deserialize, Serialize};

use crate::provider::{Message, ModelConfig, Provider};
use crate::registry::ToolDefinition;

/// All the dependencies a reflection pass needs.
///
/// Built by `RunService` when the agent has `reflection.enabled = true` and
/// passed to `RunExecutor` via `with_reflection`.
#[derive(Clone)]
pub struct ReflectionContext {
    pub db: Arc<Mutex<Database>>,
    pub embedding_svc: Arc<dyn EmbeddingService>,
    pub agent_dir: PathBuf,
    /// Root of the moxxy home directory, needed to load builtin skills for
    /// the novelty check during skill synthesis.
    pub moxxy_home: PathBuf,
    pub config: ReflectionConfig,
    /// Stable, transport-namespaced user id for the caller (e.g. `tg:12345`).
    /// When `Some` AND `config.user_profiles_enabled`, the reflection pass is
    /// allowed to patch the profile file at `<agent_dir>/users/<user_id>.md`.
    pub user_id: Option<String>,
    /// Channel id the run originated from (e.g. the Telegram chat_id). Used
    /// alongside `user_id` to route the autonomous self-approval follow-up
    /// run back to the same user.
    pub channel_id: Option<String>,
    /// Agent name used by the starter to identify this agent. Separate from
    /// `agent_id` passed into `run_reflection` because the starter is
    /// constructed alongside the context in `run_service`.
    pub agent_name: String,
    /// Optional run-starter for the autonomous self-approval follow-up run.
    /// When `Some` AND a skill is synthesized AND `user_id` is present, a
    /// follow-up run is enqueued that will invoke `skill.request_approval`.
    pub run_starter: Option<Arc<dyn RunStarter>>,
}

/// Summary of a completed run, fed to the reflection prompt.
pub struct RunSummary<'a> {
    pub agent_id: &'a str,
    pub run_id: &'a str,
    pub task: &'a str,
    pub outcome: RunOutcomeLabel,
    /// For success: the final assistant reply. For failure: the error message
    /// (or last partial content we have).
    pub final_content: &'a str,
    pub tool_call_count: u32,
    pub tool_names: Vec<String>,
    pub current_user_profile: Option<String>,
}

/// What the reflection pass writes back — either full success or a structured failure.
#[derive(Debug)]
pub struct ReflectionReport {
    pub lessons_stored: u32,
    pub journal_bytes_appended: u64,
    pub user_profile_updated: bool,
    pub skill_draft: Option<SkillDraft>,
    pub reusable: bool,
    /// Outcome of the autonomous skill synthesis attempt (if any).
    pub skill_synthesis: Option<SkillSynthesisOutcome>,
    /// Whether the session summary was written to the FTS5 index.
    pub session_summary_indexed: bool,
    /// Whether an autonomous self-approval follow-up run was enqueued (only
    /// fires when a skill was written AND a user_id + run_starter are set).
    pub self_approval_triggered: bool,
}

/// Model-emitted skill draft — acting on this is deferred to PR #4
/// (skill synthesis + quarantine). For now we return it to the caller so the
/// `SkillSynthesized` event can be emitted for observability.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillDraft {
    pub name: String,
    pub description: String,
    #[serde(default)]
    pub allowed_primitives: Vec<String>,
    pub body_markdown: String,
}

/// Exact JSON shape the reflection prompt asks the model to emit.
#[derive(Debug, Default, Serialize, Deserialize)]
pub struct ReflectionOutput {
    #[serde(default)]
    pub what_worked: Vec<String>,
    #[serde(default)]
    pub what_failed: Vec<String>,
    #[serde(default)]
    pub lessons: Vec<Lesson>,
    #[serde(default)]
    pub reusable: bool,
    #[serde(default)]
    pub reusable_reason: String,
    #[serde(default)]
    pub skill_draft: Option<SkillDraft>,
    #[serde(default)]
    pub user_profile_patch: Option<UserProfilePatch>,
    /// Terse 1–3 sentence summary of the run, FTS5-indexed for cross-session
    /// recall. Empty string (the default) means "don't index this run".
    #[serde(default)]
    pub session_summary: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Lesson {
    pub text: String,
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UserProfilePatch {
    /// Full replacement body for the user profile. Simpler than a diff and
    /// easier for the model to emit reliably. Reflection is gated on
    /// `config.user_profiles_enabled && user_id.is_some()`.
    pub replace_body: String,
}

/// Build the reflection prompt. Kept free-function so it's cheap to test.
pub fn build_prompt(summary: &RunSummary<'_>) -> String {
    let mut preview: String = summary.final_content.chars().take(1000).collect();
    if summary.final_content.chars().count() > 1000 {
        preview.push_str("\n…[truncated]");
    }

    let tool_line = if summary.tool_names.is_empty() {
        "(none)".to_string()
    } else {
        summary.tool_names.join(", ")
    };

    let profile_block = match &summary.current_user_profile {
        Some(p) if !p.trim().is_empty() => {
            format!("\n\nCURRENT USER PROFILE (may be stale):\n{p}")
        }
        _ => String::new(),
    };

    let outcome_note = match summary.outcome {
        RunOutcomeLabel::Success => {
            "The run completed successfully. Extract durable lessons and optionally a reusable skill."
        }
        RunOutcomeLabel::Failed => {
            "The run FAILED. Focus lessons on *what went wrong* and *how to avoid this class of failure next time*. Do NOT synthesize a skill from a failed run — emit null for skill_draft."
        }
        RunOutcomeLabel::Cancelled => {
            "The run was CANCELLED mid-execution. Capture any partial lessons but be conservative — emit null for skill_draft."
        }
        RunOutcomeLabel::TimedOut => {
            "The run TIMED OUT. Focus lessons on why it stalled (loop, waiting on a slow tool, unbounded search). Emit null for skill_draft."
        }
    };
    let final_label = match summary.outcome {
        RunOutcomeLabel::Success => "FINAL RESPONSE PREVIEW",
        _ => "ERROR / LAST OUTPUT PREVIEW",
    };

    format!(
        "You are the reflection stage for agent `{agent}`. {outcome_note}\n\n\
TASK: {task}\n\
OUTCOME: {outcome}\n\
TOOL CALLS ({n}): {tools}\n\
{final_label}:\n{preview}{profile}\n\n\
Reply with a SINGLE JSON object, no prose, no markdown fences. Schema:\n\
{{\n  \"what_worked\": [string, ...],\n  \"what_failed\": [string, ...],\n  \
\"lessons\": [{{\"text\": string, \"tags\": [string, ...]}}, ...],\n  \
\"reusable\": boolean,\n  \"reusable_reason\": string,\n  \
\"skill_draft\": null | {{\"name\": string, \"description\": string, \
\"allowed_primitives\": [string, ...], \"body_markdown\": string}},\n  \
\"user_profile_patch\": null | {{\"replace_body\": string}},\n  \
\"session_summary\": string\n}}\n\n\
Keep lessons terse and portable — future runs on different tasks should \
benefit. Emit `skill_draft` only when the trajectory is clearly reusable \
across similar future tasks (>= {min_tools} tool calls, non-trivial). \
`session_summary` should be 1–3 sentences capturing what this run \
accomplished — it will be indexed for future recall via `session.recall`. \
Use empty string if there's nothing worth indexing.",
        agent = summary.agent_id,
        task = summary.task,
        outcome = summary.outcome.as_str(),
        n = summary.tool_call_count,
        tools = tool_line,
        final_label = final_label,
        preview = preview,
        profile = profile_block,
        min_tools = 3,
        outcome_note = outcome_note,
    )
}

/// Strip common wrappers (```json fences, leading prose) and parse the JSON.
pub fn parse_output(raw: &str) -> Result<ReflectionOutput, serde_json::Error> {
    let trimmed = raw.trim();
    // Try straight parse first.
    if let Ok(out) = serde_json::from_str::<ReflectionOutput>(trimmed) {
        return Ok(out);
    }
    // Strip ```json fences if present.
    let stripped = trimmed
        .strip_prefix("```json")
        .or_else(|| trimmed.strip_prefix("```"))
        .unwrap_or(trimmed)
        .trim_start()
        .trim_end_matches("```")
        .trim();
    if let Ok(out) = serde_json::from_str::<ReflectionOutput>(stripped) {
        return Ok(out);
    }
    // Final attempt: extract the first {...} block.
    if let (Some(start), Some(end)) = (stripped.find('{'), stripped.rfind('}'))
        && start < end
    {
        return serde_json::from_str::<ReflectionOutput>(&stripped[start..=end]);
    }
    serde_json::from_str::<ReflectionOutput>(stripped)
}

/// Append one entry to `<agent_dir>/journal.md` with YAML frontmatter.
///
/// If the current journal would exceed `max_bytes` after the append, it is
/// first rotated: the existing file is renamed to
/// `journal.<rfc3339-basic>.md` and a fresh `journal.md` is started. This
/// keeps the hot file bounded while preserving full history on disk.
///
/// Returns the number of bytes written to the active `journal.md`.
#[allow(clippy::too_many_arguments)]
pub fn append_journal_entry(
    agent_dir: &Path,
    run_id: &str,
    agent_id: &str,
    task: &str,
    outcome: RunOutcomeLabel,
    tool_call_count: u32,
    output: &ReflectionOutput,
    max_bytes: u64,
) -> std::io::Result<u64> {
    let path = agent_dir.join("journal.md");

    let ts = chrono::Utc::now();
    let task_escaped = task.replace('"', "\\\"");
    let outcome_str = outcome.as_str();
    let mut buf = String::new();
    buf.push_str("\n---\n");
    buf.push_str(&format!("run_id: {run_id}\n"));
    buf.push_str(&format!("agent: {agent_id}\n"));
    buf.push_str(&format!("ts: {}\n", ts.to_rfc3339()));
    buf.push_str(&format!("task: \"{task_escaped}\"\n"));
    buf.push_str(&format!("outcome: {outcome_str}\n"));
    buf.push_str(&format!("tool_calls: {tool_call_count}\n"));
    buf.push_str(&format!("reusable: {}\n", output.reusable));
    buf.push_str("tags: [reflection]\n");
    buf.push_str("---\n\n");

    if !output.what_worked.is_empty() {
        buf.push_str("## What worked\n");
        for item in &output.what_worked {
            buf.push_str(&format!("- {item}\n"));
        }
        buf.push('\n');
    }
    if !output.what_failed.is_empty() {
        buf.push_str("## What failed\n");
        for item in &output.what_failed {
            buf.push_str(&format!("- {item}\n"));
        }
        buf.push('\n');
    }
    if !output.lessons.is_empty() {
        buf.push_str("## Lessons\n");
        for l in &output.lessons {
            buf.push_str(&format!("- {}\n", l.text));
        }
        buf.push('\n');
    }

    // Rotate if the current file + this new entry would exceed the cap.
    let current_size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    if max_bytes > 0 && current_size + buf.len() as u64 > max_bytes {
        let rotated_name = format!("journal.{}.md", ts.format("%Y%m%dT%H%M%SZ"));
        let rotated_path = agent_dir.join(&rotated_name);
        // If a file with that exact name already exists (same-second rotation),
        // append a millisecond-precision suffix.
        let final_rotated = if rotated_path.exists() {
            agent_dir.join(format!("journal.{}.md", ts.format("%Y%m%dT%H%M%S%3fZ")))
        } else {
            rotated_path
        };
        if path.is_file() {
            let _ = std::fs::rename(&path, &final_rotated);
        }
    }

    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)?;
    file.write_all(buf.as_bytes())?;
    Ok(buf.len() as u64)
}

/// Outcome label used in reflection journal entries and events. The model is
/// given this tag in the prompt so its lessons are framed correctly.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RunOutcomeLabel {
    Success,
    Failed,
    Cancelled,
    TimedOut,
}

impl RunOutcomeLabel {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Success => "success",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
            Self::TimedOut => "timed_out",
        }
    }
}

/// Persist a single lesson to LTM with an embedding. Returns the row id.
pub async fn store_lesson(
    ctx: &ReflectionContext,
    agent_id: &str,
    run_id: &str,
    lesson: &Lesson,
) -> Result<String, String> {
    let embedding = ctx
        .embedding_svc
        .embed(&lesson.text)
        .await
        .map_err(|e| format!("embedding failed: {e}"))?;
    let embedding_bytes = embedding_to_bytes(&embedding);

    let now = chrono::Utc::now().to_rfc3339();
    let id = uuid::Uuid::now_v7().to_string();

    // Merge caller-supplied tags with the provenance markers we always add.
    let mut tags: Vec<String> = lesson.tags.clone();
    for t in ["lesson", "reflection", &format!("run:{run_id}")] {
        if !tags.iter().any(|existing| existing == t) {
            tags.push(t.to_string());
        }
    }
    let tags_json = Some(serde_json::to_string(&tags).unwrap_or_default());

    let row = moxxy_storage::MemoryIndexRow {
        id: id.clone(),
        agent_id: agent_id.to_string(),
        markdown_path: String::new(),
        tags_json,
        chunk_hash: None,
        embedding_id: Some(id.clone()),
        status: "active".into(),
        created_at: now.clone(),
        updated_at: now,
        content: Some(lesson.text.clone()),
    };

    let db = ctx.db.lock().map_err(|e| e.to_string())?;
    db.memory()
        .insert_with_embedding(&row, &embedding_bytes)
        .map_err(|e| e.to_string())?;
    Ok(id)
}

/// Outcome of an attempt to autonomously synthesize a skill.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SkillSynthesisOutcome {
    /// Skill was written to `skills_quarantine/<slug>/SKILL.md` and awaits approval.
    Written { slug: String, path: PathBuf },
    /// Draft was rejected by the hard or soft gate. `reason` is human-readable.
    Rejected { reason: String },
    /// Draft couldn't be written due to a filesystem / parse error.
    Failed { error: String },
}

/// Jaccard similarity over whitespace tokens, lowercased. Returns 0.0 if either
/// input is empty. Used as a cheap novelty check against existing skill
/// descriptions to avoid synthesizing near-duplicates.
fn jaccard_token_similarity(a: &str, b: &str) -> f32 {
    let tok_a: std::collections::HashSet<String> = a
        .to_lowercase()
        .split_whitespace()
        .map(|s| s.to_string())
        .collect();
    let tok_b: std::collections::HashSet<String> = b
        .to_lowercase()
        .split_whitespace()
        .map(|s| s.to_string())
        .collect();
    if tok_a.is_empty() || tok_b.is_empty() {
        return 0.0;
    }
    let intersection = tok_a.intersection(&tok_b).count() as f32;
    let union = tok_a.union(&tok_b).count() as f32;
    intersection / union
}

/// Apply the synthesis gate and (if it passes) write the draft into the
/// agent's `skills_quarantine/` directory.
///
/// The two-layer gate, mirroring the plan:
///  1. Hard floor (Rust): min tool calls, draft present, slug doesn't
///     collide in `skills/` or `skills_quarantine/`, Jaccard description
///     similarity < 0.7 against any existing skill.
///  2. Soft layer (LLM-judged): `reusable == true` AND `reusable_reason`
///     is at least 20 chars (cheap sanity check).
pub fn maybe_synthesize_skill(
    agent_id: &str,
    run_id: &str,
    tool_call_count: u32,
    config: &ReflectionConfig,
    output: &ReflectionOutput,
    agent_dir: &Path,
    moxxy_home: &Path,
) -> SkillSynthesisOutcome {
    if !config.skill_synthesis_enabled {
        return SkillSynthesisOutcome::Rejected {
            reason: "skill_synthesis_enabled=false".into(),
        };
    }
    let Some(draft) = output.skill_draft.clone() else {
        return SkillSynthesisOutcome::Rejected {
            reason: "no skill_draft emitted".into(),
        };
    };
    if tool_call_count < config.min_tool_calls_for_skill {
        return SkillSynthesisOutcome::Rejected {
            reason: format!(
                "tool_call_count {} below floor {}",
                tool_call_count, config.min_tool_calls_for_skill
            ),
        };
    }
    // Soft layer: model must affirm reusability with a non-trivial reason.
    if !output.reusable || output.reusable_reason.trim().len() < 20 {
        return SkillSynthesisOutcome::Rejected {
            reason: "model judged non-reusable or insufficient reason".into(),
        };
    }

    // Build the SKILL.md body with provenance frontmatter prepended. We emit
    // fresh frontmatter rather than trusting the model's body to contain it.
    let version = "0.1.0";
    let ts = chrono::Utc::now().to_rfc3339();
    let allowed_primitives_yaml = if draft.allowed_primitives.is_empty() {
        String::new()
    } else {
        let mut s = String::from("allowed_primitives:\n");
        for p in &draft.allowed_primitives {
            s.push_str(&format!("  - {p}\n"));
        }
        s
    };
    let body_without_frontmatter = strip_leading_frontmatter(&draft.body_markdown);
    let content = format!(
        "---\nname: {name}\ndescription: {desc}\nauthor: auto-synthesized:{agent}\nversion: \"{version}\"\nsource_run_id: {run_id}\nsynthesized_at: {ts}\nstatus: quarantined\n{allowed}---\n{body}",
        name = draft.name,
        desc = draft.description.replace('\n', " "),
        agent = agent_id,
        version = version,
        run_id = run_id,
        ts = ts,
        allowed = allowed_primitives_yaml,
        body = body_without_frontmatter,
    );

    // Parse the composed document — if this fails, the frontmatter we built
    // is malformed, so bail before writing anything.
    let doc = match SkillDoc::parse(&content) {
        Ok(d) => d,
        Err(e) => {
            return SkillSynthesisOutcome::Failed {
                error: format!("composed SKILL.md failed to parse: {e}"),
            };
        }
    };
    let slug = doc.slug();

    // Novelty check — scan ALL existing skills (builtin + agent + quarantine)
    // to avoid both duplicate-slug collisions and near-duplicate descriptions.
    let mut existing = SkillLoader::load_all(moxxy_home, agent_dir);
    existing.extend(SkillLoader::load_quarantine(agent_dir));

    for skill in &existing {
        if skill.doc.slug() == slug {
            return SkillSynthesisOutcome::Rejected {
                reason: format!("slug '{slug}' already exists"),
            };
        }
        let similarity = jaccard_token_similarity(&skill.doc.description, &doc.description);
        if similarity > 0.7 {
            return SkillSynthesisOutcome::Rejected {
                reason: format!(
                    "description overlaps existing skill '{}' (jaccard {:.2})",
                    skill.doc.name, similarity
                ),
            };
        }
    }

    // Write to quarantine.
    let quarantine_dir = agent_dir.join("skills_quarantine").join(&slug);
    if let Err(e) = std::fs::create_dir_all(&quarantine_dir) {
        return SkillSynthesisOutcome::Failed {
            error: format!("failed to create quarantine dir: {e}"),
        };
    }
    let skill_path = quarantine_dir.join("SKILL.md");
    if let Err(e) = std::fs::write(&skill_path, &content) {
        return SkillSynthesisOutcome::Failed {
            error: format!("failed to write SKILL.md: {e}"),
        };
    }

    tracing::info!(
        agent_id,
        run_id,
        slug = %slug,
        path = %skill_path.display(),
        "Synthesized skill into quarantine"
    );

    SkillSynthesisOutcome::Written {
        slug,
        path: skill_path,
    }
}

/// If `body` starts with `---\n...\n---\n`, return the remainder — otherwise
/// return the body unchanged. The model sometimes emits frontmatter inside
/// `body_markdown`; we strip it and prepend our own provenance block.
fn strip_leading_frontmatter(body: &str) -> &str {
    let trimmed = body.trim_start_matches('\n');
    if let Some(rest) = trimmed.strip_prefix("---\n")
        && let Some(end) = rest.find("\n---\n")
    {
        return &rest[end + 5..];
    }
    body
}

/// Write a patched user profile. Callers must have already checked
/// `config.user_profiles_enabled && user_id.is_some()`.
///
/// Concurrency: writes to a temp file in the same directory then atomically
/// renames over the target. On POSIX `rename(2)` is atomic, so concurrent
/// reflection passes for the same user can't produce a torn file. The
/// last-write-wins semantics remain (this is inherent — two reflections
/// finishing simultaneously WILL race on which patch survives), but there
/// is no partially-written intermediate state a reader could observe.
pub fn apply_user_profile_patch(
    agent_dir: &Path,
    user_id: &str,
    patch: &UserProfilePatch,
) -> std::io::Result<()> {
    // Sanitize the same way the user_profile primitive does.
    if user_id.is_empty()
        || user_id.contains("..")
        || user_id.contains('/')
        || user_id.contains('\\')
    {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "invalid user_id for profile patch",
        ));
    }
    let slug: String = user_id
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | ':') {
                c
            } else {
                '_'
            }
        })
        .collect();
    let users_dir = agent_dir.join("users");
    std::fs::create_dir_all(&users_dir)?;
    let target = users_dir.join(format!("{slug}.md"));
    let tmp = users_dir.join(format!(".{slug}.{}.tmp", uuid::Uuid::now_v7().simple()));
    std::fs::write(&tmp, &patch.replace_body)?;
    // rename is atomic on POSIX; on Windows std::fs::rename can fail if the
    // target exists, so fall back to remove + rename.
    match std::fs::rename(&tmp, &target) {
        Ok(()) => Ok(()),
        Err(_) => {
            let _ = std::fs::remove_file(&target);
            let r = std::fs::rename(&tmp, &target);
            if r.is_err() {
                let _ = std::fs::remove_file(&tmp);
            }
            r
        }
    }
}

/// Count tool calls across all assistant messages and collect distinct names.
pub fn summarize_tool_usage(conversation: &[Message]) -> (u32, Vec<String>) {
    let mut count: u32 = 0;
    let mut names: Vec<String> = Vec::new();
    for msg in conversation {
        if let Some(calls) = &msg.tool_calls {
            count += calls.len() as u32;
            for c in calls {
                if !names.iter().any(|n| n == &c.name) {
                    names.push(c.name.clone());
                }
            }
        }
    }
    (count, names)
}

/// Load the current per-end-user profile for the run, or None.
pub fn load_user_profile(ctx: &ReflectionContext) -> Option<String> {
    if !ctx.config.user_profiles_enabled {
        return None;
    }
    let user_id = ctx.user_id.as_ref()?;
    let slug: String = user_id
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | ':') {
                c
            } else {
                '_'
            }
        })
        .collect();
    let path = ctx.agent_dir.join("users").join(format!("{slug}.md"));
    std::fs::read_to_string(path).ok()
}

/// Execute the reflection pass end-to-end. Returns a `ReflectionReport`
/// summarizing what was persisted, or an error string if anything failed
/// catastrophically (provider error, parse failure after retries).
#[allow(clippy::too_many_arguments)]
pub async fn run_reflection(
    ctx: &ReflectionContext,
    provider: Arc<dyn Provider>,
    base_model_config: &ModelConfig,
    agent_id: &str,
    run_id: &str,
    task: &str,
    outcome: RunOutcomeLabel,
    final_content: &str,
    conversation: &[Message],
) -> Result<ReflectionReport, String> {
    let (tool_call_count, tool_names) = summarize_tool_usage(conversation);
    let current_user_profile = load_user_profile(ctx);

    let summary = RunSummary {
        agent_id,
        run_id,
        task,
        outcome,
        final_content,
        tool_call_count,
        tool_names,
        current_user_profile,
    };
    let prompt = build_prompt(&summary);
    let messages = vec![Message::user(prompt)];

    // Reflection should NOT call tools — we want a single JSON response.
    // Use the agent's primary provider + low temperature for deterministic JSON.
    let model_config = ModelConfig {
        temperature: base_model_config.temperature.min(0.3),
        max_tokens: 2048,
        tool_choice: crate::provider::ToolChoice::Auto,
    };
    let empty_tools: Vec<ToolDefinition> = Vec::new();

    let resp = provider
        .complete(messages, &model_config, &empty_tools)
        .await
        .map_err(|e| format!("reflection provider call failed: {e}"))?;

    let mut output = parse_output(&resp.content)
        .map_err(|e| format!("reflection output parse failed: {e}; raw: {}", resp.content))?;

    // Safety: never synthesize a skill from a non-successful run. We belt-and-
    // suspenders this here in case the model ignores the prompt instruction.
    if outcome != RunOutcomeLabel::Success {
        output.skill_draft = None;
    }

    // Persist journal entry first — cheapest, never fails loudly.
    let journal_bytes = append_journal_entry(
        &ctx.agent_dir,
        run_id,
        agent_id,
        task,
        outcome,
        tool_call_count,
        &output,
        ctx.config.journal_max_bytes,
    )
    .map_err(|e| format!("journal append failed: {e}"))?;

    // Store each lesson in LTM. Partial success is acceptable; we log but
    // don't abort the reflection on a single embedding/db hiccup.
    let mut lessons_stored: u32 = 0;
    for lesson in &output.lessons {
        match store_lesson(ctx, agent_id, run_id, lesson).await {
            Ok(_) => lessons_stored += 1,
            Err(e) => tracing::warn!(error = %e, agent_id, "Failed to store reflection lesson"),
        }
    }

    // Patch user profile if allowed and emitted.
    let mut user_profile_updated = false;
    if ctx.config.user_profiles_enabled
        && let Some(user_id) = &ctx.user_id
        && let Some(patch) = &output.user_profile_patch
    {
        match apply_user_profile_patch(&ctx.agent_dir, user_id, patch) {
            Ok(()) => user_profile_updated = true,
            Err(e) => {
                tracing::warn!(error = %e, agent_id, user_id, "Failed to apply user profile patch")
            }
        }
    }

    // Persist FTS5 session summary if one was emitted. Cross-session recall
    // keys off task + summary content.
    let mut session_summary_indexed = false;
    if !output.session_summary.trim().is_empty() {
        let row = moxxy_storage::SessionSummaryRow {
            run_id: run_id.to_string(),
            agent_id: agent_id.to_string(),
            user_id: ctx.user_id.clone(),
            ts: chrono::Utc::now().timestamp(),
            tool_call_count: tool_call_count as i64,
            task: task.to_string(),
            summary: output.session_summary.clone(),
        };
        match ctx.db.lock().map_err(|e| e.to_string()).and_then(|db| {
            db.session_summaries()
                .insert(&row)
                .map_err(|e| e.to_string())
        }) {
            Ok(()) => session_summary_indexed = true,
            Err(e) => {
                tracing::warn!(error = %e, agent_id, run_id, "Failed to index session summary")
            }
        }
    }

    // Attempt autonomous skill synthesis. Never fails the reflection pass —
    // outcome is recorded in the report and surfaced via events.
    let skill_synthesis = if output.skill_draft.is_some() {
        Some(maybe_synthesize_skill(
            agent_id,
            run_id,
            tool_call_count,
            &ctx.config,
            &output,
            &ctx.agent_dir,
            &ctx.moxxy_home,
        ))
    } else {
        None
    };

    // Autonomous self-approval follow-up: when synthesis succeeded AND we
    // have both a user_id and a run_starter, enqueue a tiny follow-up run
    // that invokes `skill.request_approval`. The agent will pause on
    // `user.ask` and the human answers via the same channel that triggered
    // the original run. No-ops if any precondition is missing — keeps
    // quarantined skills safely parked for manual approval via the REST
    // endpoint instead.
    let mut self_approval_triggered = false;
    if let Some(SkillSynthesisOutcome::Written { slug, .. }) = skill_synthesis.as_ref()
        && let Some(user_id) = ctx.user_id.as_deref()
        && let Some(starter) = ctx.run_starter.as_ref()
    {
        let rationale = if output.reusable_reason.trim().is_empty() {
            format!(
                "Trajectory was reusable across {} tool calls — this skill \
                 captures the pattern so future similar tasks can reuse it.",
                tool_call_count
            )
        } else {
            output.reusable_reason.clone()
        };
        let rationale_json = serde_json::to_string(&rationale).unwrap_or_else(|_| "\"\"".into());
        let task = format!(
            "I just synthesized a new skill from the prior task and want your approval to add it to my active toolkit. \
             Call the `skill.request_approval` primitive with slug={slug:?} and rationale={rationale_json}. \
             Do nothing else — reply with whatever the primitive returns."
        );
        let trigger = moxxy_types::RunTrigger::new(task, "reflection.self_approval")
            .with_user_id(user_id.to_string());
        let trigger = if let Some(cid) = ctx.channel_id.as_deref() {
            trigger.with_channel_id(cid.to_string())
        } else {
            trigger
        };
        let agent_name = ctx.agent_name.clone();
        let starter = starter.clone();
        // Fire-and-forget: don't await the whole run, just the queueing call.
        // If enqueueing fails, log — the skill is still safely in quarantine.
        match starter
            .start_or_queue_with_context(&agent_name, trigger)
            .await
        {
            Ok(_) => {
                self_approval_triggered = true;
                tracing::info!(
                    agent_id,
                    run_id,
                    slug = %slug,
                    "Enqueued autonomous self-approval run for synthesized skill"
                );
            }
            Err(e) => tracing::warn!(
                agent_id,
                run_id,
                slug = %slug,
                error = %e,
                "Failed to enqueue self-approval run"
            ),
        }
    }

    Ok(ReflectionReport {
        lessons_stored,
        journal_bytes_appended: journal_bytes,
        user_profile_updated,
        skill_draft: output.skill_draft,
        reusable: output.reusable,
        skill_synthesis,
        session_summary_indexed,
        self_approval_triggered,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn minimal_config(synthesis: bool) -> ReflectionConfig {
        ReflectionConfig {
            enabled: true,
            skill_synthesis_enabled: synthesis,
            user_profiles_enabled: false,
            min_tool_calls_for_skill: 3,
            journal_max_bytes: 1_000_000,
            timeout_secs: 30,
            skill_history_max_versions: 10,
        }
    }

    fn sample_draft() -> SkillDraft {
        SkillDraft {
            name: "Web Report Fetcher".into(),
            description: "Fetches and summarizes public quarterly reports from URLs".into(),
            allowed_primitives: vec!["browse.fetch".into(), "memory.store".into()],
            body_markdown:
                "# Instructions\n1. Use browse.fetch\n2. Summarize\n3. Store in memory\n".into(),
        }
    }

    fn synthesis_output(
        reusable: bool,
        reason: &str,
        draft: Option<SkillDraft>,
    ) -> ReflectionOutput {
        ReflectionOutput {
            what_worked: vec![],
            what_failed: vec![],
            lessons: vec![],
            reusable,
            reusable_reason: reason.into(),
            skill_draft: draft,
            user_profile_patch: None,
            session_summary: String::new(),
        }
    }

    #[test]
    fn synthesis_rejected_when_disabled() {
        let tmp = TempDir::new().unwrap();
        let out = synthesis_output(
            true,
            "reason long enough for sanity check",
            Some(sample_draft()),
        );
        let result = maybe_synthesize_skill(
            "alice",
            "run-1",
            5,
            &minimal_config(false),
            &out,
            tmp.path(),
            tmp.path(),
        );
        assert!(matches!(result, SkillSynthesisOutcome::Rejected { .. }));
    }

    #[test]
    fn synthesis_rejected_below_tool_call_floor() {
        let tmp = TempDir::new().unwrap();
        let out = synthesis_output(
            true,
            "reason long enough for sanity check",
            Some(sample_draft()),
        );
        let result = maybe_synthesize_skill(
            "alice",
            "run-1",
            2, // below floor of 3
            &minimal_config(true),
            &out,
            tmp.path(),
            tmp.path(),
        );
        match result {
            SkillSynthesisOutcome::Rejected { reason } => assert!(reason.contains("floor")),
            _ => panic!("expected Rejected"),
        }
    }

    #[test]
    fn synthesis_rejected_when_not_reusable() {
        let tmp = TempDir::new().unwrap();
        let out = synthesis_output(false, "x", Some(sample_draft()));
        let result = maybe_synthesize_skill(
            "alice",
            "run-1",
            10,
            &minimal_config(true),
            &out,
            tmp.path(),
            tmp.path(),
        );
        match result {
            SkillSynthesisOutcome::Rejected { reason } => assert!(reason.contains("reusable")),
            _ => panic!("expected Rejected"),
        }
    }

    #[test]
    fn synthesis_writes_to_quarantine_with_provenance() {
        let tmp = TempDir::new().unwrap();
        let out = synthesis_output(
            true,
            "Multi-step research flow likely to recur across future tasks",
            Some(sample_draft()),
        );
        let result = maybe_synthesize_skill(
            "alice",
            "run-abc",
            5,
            &minimal_config(true),
            &out,
            tmp.path(),
            tmp.path(),
        );
        let path = match result {
            SkillSynthesisOutcome::Written { path, .. } => path,
            other => panic!("expected Written, got {:?}", other),
        };
        assert!(path.exists());
        // Verify provenance frontmatter made it in
        let body = std::fs::read_to_string(&path).unwrap();
        assert!(body.contains("author: auto-synthesized:alice"));
        assert!(body.contains("source_run_id: run-abc"));
        assert!(body.contains("status: quarantined"));
        // Verify it's under skills_quarantine, NOT skills
        assert!(path.to_string_lossy().contains("skills_quarantine"));
    }

    #[test]
    fn synthesis_rejected_on_slug_collision() {
        let tmp = TempDir::new().unwrap();
        // Create a skill with the same slug in active skills/
        let existing = tmp.path().join("skills").join("web-report-fetcher");
        std::fs::create_dir_all(&existing).unwrap();
        std::fs::write(
            existing.join("SKILL.md"),
            "---\nname: Web Report Fetcher\ndescription: existing\nauthor: me\nversion: \"1.0\"\n---\nbody",
        )
        .unwrap();

        let out = synthesis_output(
            true,
            "Multi-step research flow likely to recur across future tasks",
            Some(sample_draft()),
        );
        let result = maybe_synthesize_skill(
            "alice",
            "run-1",
            5,
            &minimal_config(true),
            &out,
            tmp.path(),
            tmp.path(),
        );
        match result {
            SkillSynthesisOutcome::Rejected { reason } => {
                assert!(reason.contains("slug") || reason.contains("already exists"))
            }
            other => panic!("expected Rejected, got {:?}", other),
        }
    }

    #[test]
    fn jaccard_similarity_basic() {
        assert_eq!(jaccard_token_similarity("hello world", "hello world"), 1.0);
        assert_eq!(jaccard_token_similarity("", "a"), 0.0);
        let sim = jaccard_token_similarity("fetch web pages", "fetch web content");
        assert!((0.0..1.0).contains(&sim));
    }

    #[test]
    fn strip_leading_frontmatter_removes_block() {
        let input = "---\nname: x\n---\nbody content";
        assert_eq!(strip_leading_frontmatter(input), "body content");
    }

    #[test]
    fn strip_leading_frontmatter_passthrough_without_block() {
        let input = "just body content";
        assert_eq!(strip_leading_frontmatter(input), "just body content");
    }

    fn sample_output() -> ReflectionOutput {
        ReflectionOutput {
            what_worked: vec!["Used browser to fetch the report".into()],
            what_failed: vec![],
            lessons: vec![Lesson {
                text: "Prefer direct URL when the report is public.".into(),
                tags: vec!["research".into()],
            }],
            reusable: true,
            reusable_reason: "Multi-step research flow, likely recurring.".into(),
            skill_draft: None,
            user_profile_patch: Some(UserProfilePatch {
                replace_body: "# User\nPrefers terse summaries.".into(),
            }),
            session_summary: String::new(),
        }
    }

    #[test]
    fn build_prompt_mentions_task_and_tool_count() {
        let summary = RunSummary {
            agent_id: "alice",
            run_id: "run-1",
            task: "summarize Q1",
            outcome: RunOutcomeLabel::Success,
            final_content: "Done.",
            tool_call_count: 5,
            tool_names: vec!["browser.navigate".into(), "memory.store".into()],
            current_user_profile: None,
        };
        let p = build_prompt(&summary);
        assert!(p.contains("summarize Q1"));
        assert!(p.contains("TOOL CALLS (5)"));
        assert!(p.contains("browser.navigate"));
        assert!(p.contains("completed successfully"));
    }

    #[test]
    fn build_prompt_failure_tells_model_no_skill() {
        let summary = RunSummary {
            agent_id: "alice",
            run_id: "run-2",
            task: "try a thing",
            outcome: RunOutcomeLabel::Failed,
            final_content: "TypeError: foo is undefined",
            tool_call_count: 1,
            tool_names: vec![],
            current_user_profile: None,
        };
        let p = build_prompt(&summary);
        assert!(p.contains("FAILED"));
        assert!(p.contains("null for skill_draft"));
        assert!(p.contains("ERROR / LAST OUTPUT PREVIEW"));
    }

    #[test]
    fn parse_output_handles_plain_json() {
        let raw = r#"{"what_worked":["a"],"what_failed":[],"lessons":[],"reusable":false,"reusable_reason":"","skill_draft":null,"user_profile_patch":null}"#;
        let out = parse_output(raw).unwrap();
        assert_eq!(out.what_worked, vec!["a".to_string()]);
        assert!(!out.reusable);
    }

    #[test]
    fn parse_output_handles_json_fences() {
        let raw = "```json\n{\"what_worked\":[\"x\"],\"reusable\":true}\n```";
        let out = parse_output(raw).unwrap();
        assert_eq!(out.what_worked, vec!["x".to_string()]);
        assert!(out.reusable);
    }

    #[test]
    fn parse_output_extracts_embedded_json() {
        let raw = "Sure! Here is the reflection:\n{\"what_worked\":[\"y\"]}\nHope that helps.";
        let out = parse_output(raw).unwrap();
        assert_eq!(out.what_worked, vec!["y".to_string()]);
    }

    #[test]
    fn append_journal_entry_creates_and_appends() {
        let tmp = TempDir::new().unwrap();
        let out = sample_output();

        let bytes1 = append_journal_entry(
            tmp.path(),
            "run-1",
            "alice",
            "task one",
            RunOutcomeLabel::Success,
            4,
            &out,
            1_000_000,
        )
        .unwrap();
        assert!(bytes1 > 0);

        let bytes2 = append_journal_entry(
            tmp.path(),
            "run-2",
            "alice",
            "task two",
            RunOutcomeLabel::Success,
            7,
            &out,
            1_000_000,
        )
        .unwrap();
        assert!(bytes2 > 0);

        let body = std::fs::read_to_string(tmp.path().join("journal.md")).unwrap();
        assert!(body.contains("run_id: run-1"));
        assert!(body.contains("run_id: run-2"));
        assert!(body.contains("tool_calls: 4"));
        assert!(body.contains("tool_calls: 7"));
        // Both entries should be present
        assert_eq!(body.matches("## Lessons").count(), 2);
    }

    #[test]
    fn append_journal_entry_rotates_at_cap() {
        let tmp = TempDir::new().unwrap();
        let out = sample_output();
        // Write once with a tiny cap so the second append triggers rotation.
        append_journal_entry(
            tmp.path(),
            "run-1",
            "alice",
            "task one",
            RunOutcomeLabel::Success,
            1,
            &out,
            1_000_000,
        )
        .unwrap();

        // Cap below current file size: second write should rotate first.
        append_journal_entry(
            tmp.path(),
            "run-2",
            "alice",
            "task two",
            RunOutcomeLabel::Success,
            1,
            &out,
            100, // forces rotation
        )
        .unwrap();

        // journal.md exists with only the second entry
        let active = std::fs::read_to_string(tmp.path().join("journal.md")).unwrap();
        assert!(active.contains("run_id: run-2"));
        assert!(!active.contains("run_id: run-1"));

        // A rotated journal.<ts>.md must also exist
        let rotated: Vec<_> = std::fs::read_dir(tmp.path())
            .unwrap()
            .flatten()
            .filter(|e| {
                e.file_name().to_string_lossy().starts_with("journal.")
                    && e.path().extension().and_then(|s| s.to_str()) == Some("md")
                    && e.file_name() != "journal.md"
            })
            .collect();
        assert_eq!(rotated.len(), 1);
        let rotated_body = std::fs::read_to_string(rotated[0].path()).unwrap();
        assert!(rotated_body.contains("run_id: run-1"));
    }

    #[test]
    fn append_journal_entry_records_failed_outcome() {
        let tmp = TempDir::new().unwrap();
        let out = sample_output();
        append_journal_entry(
            tmp.path(),
            "run-x",
            "alice",
            "try",
            RunOutcomeLabel::Failed,
            2,
            &out,
            1_000_000,
        )
        .unwrap();
        let body = std::fs::read_to_string(tmp.path().join("journal.md")).unwrap();
        assert!(body.contains("outcome: failed"));
    }

    #[test]
    fn apply_user_profile_patch_writes_file() {
        let tmp = TempDir::new().unwrap();
        let patch = UserProfilePatch {
            replace_body: "# hello".into(),
        };
        apply_user_profile_patch(tmp.path(), "tg:42", &patch).unwrap();
        let body = std::fs::read_to_string(tmp.path().join("users").join("tg:42.md")).unwrap();
        assert_eq!(body, "# hello");
    }

    #[test]
    fn apply_user_profile_patch_rejects_traversal() {
        let tmp = TempDir::new().unwrap();
        let patch = UserProfilePatch {
            replace_body: "x".into(),
        };
        let result = apply_user_profile_patch(tmp.path(), "../evil", &patch);
        assert!(result.is_err());
    }

    #[test]
    fn summarize_tool_usage_counts_across_messages() {
        use crate::provider::ToolCall;
        let msgs = vec![
            Message::user("task"),
            Message::assistant_with_tool_calls(
                "",
                vec![
                    ToolCall {
                        id: "1".into(),
                        name: "fs.read".into(),
                        arguments: serde_json::json!({}),
                    },
                    ToolCall {
                        id: "2".into(),
                        name: "fs.write".into(),
                        arguments: serde_json::json!({}),
                    },
                ],
            ),
            Message::assistant_with_tool_calls(
                "",
                vec![ToolCall {
                    id: "3".into(),
                    name: "fs.read".into(),
                    arguments: serde_json::json!({}),
                }],
            ),
        ];
        let (count, names) = summarize_tool_usage(&msgs);
        assert_eq!(count, 3);
        // Distinct names, preserving first-seen order
        assert_eq!(names, vec!["fs.read".to_string(), "fs.write".to_string()]);
    }
}
