use async_trait::async_trait;
use moxxy_core::{EventBus, SkillDoc, SkillLoader};
use moxxy_types::{EventEnvelope, EventType};
use std::path::PathBuf;

use crate::primitives::ask::AskChannels;
use crate::registry::{Primitive, PrimitiveError};

// ---------------------------------------------------------------------------
// skill.create (formerly skill.import)
// ---------------------------------------------------------------------------

pub struct SkillCreatePrimitive {
    agent_skills_dir: PathBuf,
    moxxy_home: PathBuf,
    agent_dir: PathBuf,
}

impl SkillCreatePrimitive {
    pub fn new(agent_skills_dir: PathBuf, moxxy_home: PathBuf, agent_dir: PathBuf) -> Self {
        Self {
            agent_skills_dir,
            moxxy_home,
            agent_dir,
        }
    }
}

#[async_trait]
impl Primitive for SkillCreatePrimitive {
    fn name(&self) -> &str {
        "skill.create"
    }

    fn description(&self) -> &str {
        "Create a new skill. Content is a Markdown file with YAML frontmatter. Required fields: name (string), description (short summary), author (string), version (quoted string e.g. \"1.0\"). Optional: allowed_primitives (list), inputs_schema (object), safety_notes (string)."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "content": {
                    "type": "string",
                    "description": "Skill document content. Must start with YAML frontmatter between --- delimiters. Example:\n---\nname: Web Scraper\ndescription: Scrapes web pages and extracts data\nauthor: my-team\nversion: \"1.0\"\nallowed_primitives:\n  - browse.fetch\n  - fs.write\n---\n# Instructions\nUse browse.fetch to load the page, then extract data."
                }
            },
            "required": ["content"]
        })
    }

    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        let content = params["content"]
            .as_str()
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'content' parameter".into()))?;

        let doc =
            SkillDoc::parse(content).map_err(|e| PrimitiveError::InvalidParams(e.to_string()))?;

        let new_slug = doc.slug();

        // Duplicate detection: check existing skills
        let existing = SkillLoader::load_all(&self.moxxy_home, &self.agent_dir);
        for skill in &existing {
            if skill.doc.slug() == new_slug {
                return Err(PrimitiveError::InvalidParams(format!(
                    "A skill with name '{}' already exists. Use skill.remove to delete it first, or choose a different name.",
                    skill.doc.name
                )));
            }
        }

        // Check for similar descriptions
        let mut similar_skills: Vec<serde_json::Value> = Vec::new();
        let new_desc_lower = doc.description.to_lowercase();
        for skill in &existing {
            let existing_desc_lower = skill.doc.description.to_lowercase();
            // Check if either description contains the other as a substring (min 10 chars to avoid noise)
            if new_desc_lower.len() >= 10
                && (existing_desc_lower.contains(&new_desc_lower)
                    || new_desc_lower.contains(&existing_desc_lower))
            {
                similar_skills.push(serde_json::json!({
                    "name": skill.doc.name,
                    "description": skill.doc.description,
                }));
            }
        }

        let skill_dir = self.agent_skills_dir.join(&new_slug);
        std::fs::create_dir_all(&skill_dir).map_err(|e| {
            PrimitiveError::ExecutionFailed(format!("failed to create skill dir: {e}"))
        })?;

        let skill_path = skill_dir.join("SKILL.md");
        std::fs::write(&skill_path, content).map_err(|e| {
            PrimitiveError::ExecutionFailed(format!("failed to write SKILL.md: {e}"))
        })?;

        tracing::info!(
            slug = %new_slug,
            name = %doc.name,
            version = %doc.version,
            path = %skill_path.display(),
            "Skill created"
        );

        let mut result = serde_json::json!({
            "status": "created",
            "name": doc.name,
            "slug": new_slug,
            "version": doc.version,
            "path": skill_path.display().to_string(),
        });

        if !similar_skills.is_empty() {
            result["similar_skills"] = serde_json::json!(similar_skills);
        }

        Ok(result)
    }
}

// ---------------------------------------------------------------------------
// skill.validate
// ---------------------------------------------------------------------------

pub struct SkillValidatePrimitive;

impl Default for SkillValidatePrimitive {
    fn default() -> Self {
        Self::new()
    }
}

impl SkillValidatePrimitive {
    pub fn new() -> Self {
        Self
    }
}

#[async_trait]
impl Primitive for SkillValidatePrimitive {
    fn name(&self) -> &str {
        "skill.validate"
    }

    fn description(&self) -> &str {
        "Validate a skill document without creating it. Content is a Markdown file with YAML frontmatter. Required fields: name (string), description (short summary), author (string), version (quoted string e.g. \"1.0\"). Optional: allowed_primitives (list), inputs_schema (object), safety_notes (string)."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "content": {
                    "type": "string",
                    "description": "Skill document content. Must start with YAML frontmatter between --- delimiters. Example:\n---\nname: Web Scraper\ndescription: Scrapes web pages and extracts data\nauthor: my-team\nversion: \"1.0\"\n---\n# Instructions\nBody here."
                }
            },
            "required": ["content"]
        })
    }

    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        let content = params["content"]
            .as_str()
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'content' parameter".into()))?;

        tracing::debug!(content_len = content.len(), "Validating skill document");

        let doc =
            SkillDoc::parse(content).map_err(|e| PrimitiveError::InvalidParams(e.to_string()))?;

        Ok(serde_json::json!({
            "valid": true,
            "name": doc.name,
            "slug": doc.slug(),
            "description": doc.description,
            "version": doc.version,
            "allowed_primitives": doc.allowed_primitives,
        }))
    }
}

// ---------------------------------------------------------------------------
// skill.list - only current agent's skills
// ---------------------------------------------------------------------------

pub struct SkillListPrimitive {
    agent_dir: PathBuf,
}

impl SkillListPrimitive {
    pub fn new(agent_dir: PathBuf) -> Self {
        Self { agent_dir }
    }
}

#[async_trait]
impl Primitive for SkillListPrimitive {
    fn name(&self) -> &str {
        "skill.list"
    }

    fn description(&self) -> &str {
        "List skills installed on this agent."
    }

    fn is_concurrent_safe(&self) -> bool {
        true
    }

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {}
        })
    }

    async fn invoke(
        &self,
        _params: serde_json::Value,
    ) -> Result<serde_json::Value, PrimitiveError> {
        let skills = SkillLoader::load_agent(&self.agent_dir);

        let result: Vec<serde_json::Value> = skills
            .iter()
            .map(|s| {
                serde_json::json!({
                    "name": s.doc.name,
                    "slug": s.doc.slug(),
                    "description": s.doc.description,
                    "version": s.doc.version,
                })
            })
            .collect();

        Ok(serde_json::json!({ "skills": result }))
    }
}

// ---------------------------------------------------------------------------
// skill.find - discover skills by intent
// ---------------------------------------------------------------------------

pub struct SkillFindPrimitive {
    moxxy_home: PathBuf,
    agent_dir: PathBuf,
}

impl SkillFindPrimitive {
    pub fn new(moxxy_home: PathBuf, agent_dir: PathBuf) -> Self {
        Self {
            moxxy_home,
            agent_dir,
        }
    }
}

#[async_trait]
impl Primitive for SkillFindPrimitive {
    fn name(&self) -> &str {
        "skill.find"
    }

    fn description(&self) -> &str {
        "Search for skills matching a query. Searches skill names, descriptions, and body content."
    }

    fn is_concurrent_safe(&self) -> bool {
        true
    }

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Search query describing what kind of skill you need"
                }
            },
            "required": ["query"]
        })
    }

    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        let query = params["query"]
            .as_str()
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'query' parameter".into()))?;

        let all_skills = SkillLoader::load_all(&self.moxxy_home, &self.agent_dir);

        let query_lower = query.to_lowercase();
        let query_terms: Vec<&str> = query_lower.split_whitespace().collect();

        let mut scored: Vec<(usize, &moxxy_core::LoadedSkill)> = all_skills
            .iter()
            .filter_map(|skill| {
                let name_lower = skill.doc.name.to_lowercase();
                let desc_lower = skill.doc.description.to_lowercase();
                let body_lower = skill.doc.body.to_lowercase();

                let mut score: usize = 0;
                for term in &query_terms {
                    if name_lower.contains(term) {
                        score += 10;
                    }
                    if desc_lower.contains(term) {
                        score += 5;
                    }
                    if body_lower.contains(term) {
                        score += 1;
                    }
                }

                if score > 0 {
                    Some((score, skill))
                } else {
                    None
                }
            })
            .collect();

        // Sort by score descending
        scored.sort_by(|a, b| b.0.cmp(&a.0));

        let results: Vec<serde_json::Value> = scored
            .iter()
            .map(|(_, skill)| {
                let source = match skill.source {
                    moxxy_core::SkillSource::Builtin => "builtin",
                    moxxy_core::SkillSource::Agent => "agent",
                    moxxy_core::SkillSource::Quarantined => "quarantined",
                };
                serde_json::json!({
                    "name": skill.doc.name,
                    "description": skill.doc.description,
                    "author": skill.doc.author,
                    "version": skill.doc.version,
                    "source": source,
                    "inputs_schema": skill.doc.inputs_schema,
                })
            })
            .collect();

        let mut response = serde_json::json!({ "skills": results });
        if !results.is_empty() {
            response["hint"] = serde_json::json!(
                "Use skill.execute with the skill name and required inputs to run a matching skill. Check inputs_schema for required fields."
            );
        }
        Ok(response)
    }
}

// ---------------------------------------------------------------------------
// skill.get - load full skill content
// ---------------------------------------------------------------------------

pub struct SkillGetPrimitive {
    moxxy_home: PathBuf,
    agent_dir: PathBuf,
}

impl SkillGetPrimitive {
    pub fn new(moxxy_home: PathBuf, agent_dir: PathBuf) -> Self {
        Self {
            moxxy_home,
            agent_dir,
        }
    }
}

#[async_trait]
impl Primitive for SkillGetPrimitive {
    fn name(&self) -> &str {
        "skill.get"
    }

    fn description(&self) -> &str {
        "Load the full content of a skill by name. Agent skills take priority over built-in skills."
    }

    fn is_concurrent_safe(&self) -> bool {
        true
    }

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "name": {
                    "type": "string",
                    "description": "Name of the skill to load"
                }
            },
            "required": ["name"]
        })
    }

    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        let name = params["name"]
            .as_str()
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'name' parameter".into()))?;

        let skill = find_skill_by_name(&self.moxxy_home, &self.agent_dir, name)?;

        Ok(serde_json::json!({
            "name": skill.doc.name,
            "description": skill.doc.description,
            "author": skill.doc.author,
            "version": skill.doc.version,
            "allowed_primitives": skill.doc.allowed_primitives,
            "inputs_schema": skill.doc.inputs_schema,
            "body": skill.doc.body,
        }))
    }
}

// ---------------------------------------------------------------------------
// skill.execute - execute a skill
// ---------------------------------------------------------------------------

pub struct SkillExecutePrimitive {
    moxxy_home: PathBuf,
    agent_dir: PathBuf,
}

impl SkillExecutePrimitive {
    pub fn new(moxxy_home: PathBuf, agent_dir: PathBuf) -> Self {
        Self {
            moxxy_home,
            agent_dir,
        }
    }
}

#[async_trait]
impl Primitive for SkillExecutePrimitive {
    fn name(&self) -> &str {
        "skill.execute"
    }

    fn description(&self) -> &str {
        "Execute a skill by name. Loads the skill, validates inputs against its schema, and returns the full instructions to follow."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "name": {
                    "type": "string",
                    "description": "Name of the skill to execute"
                },
                "inputs": {
                    "type": "object",
                    "description": "Input values for the skill (validated against inputs_schema)"
                }
            },
            "required": ["name"]
        })
    }

    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        let name = params["name"]
            .as_str()
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'name' parameter".into()))?;

        let inputs = params
            .get("inputs")
            .cloned()
            .unwrap_or(serde_json::json!({}));

        let skill = find_skill_by_name(&self.moxxy_home, &self.agent_dir, name)?;

        // Check for missing required inputs (warn, don't reject)
        let mut missing_inputs: Vec<String> = Vec::new();
        if let Some(required_arr) = skill
            .doc
            .inputs_schema
            .get("required")
            .and_then(|v| v.as_array())
        {
            for req in required_arr {
                if let Some(field_name) = req.as_str()
                    && (inputs.get(field_name).is_none() || inputs[field_name].is_null())
                {
                    missing_inputs.push(field_name.to_string());
                }
            }
        }

        let mut result = serde_json::json!({
            "name": skill.doc.name,
            "version": skill.doc.version,
            "instructions": skill.doc.body,
            "inputs": inputs,
            "inputs_schema": skill.doc.inputs_schema,
            "allowed_primitives": skill.doc.allowed_primitives,
        });

        if !missing_inputs.is_empty() {
            result["missing_inputs"] = serde_json::json!(missing_inputs);
            result["warning"] = serde_json::json!(format!(
                "Missing required inputs: {}. Provide these values to follow the skill instructions correctly.",
                missing_inputs.join(", ")
            ));
        }

        Ok(result)
    }
}

// ---------------------------------------------------------------------------
// skill.request_approval — agent-initiated, human-gated promotion from
// quarantine to the active tool catalog.
//
// The agent can draft skills autonomously (via reflection), but this
// primitive is the ONLY way to bring them into the tool catalog without a
// gateway API call. It uses the existing `user.ask` channel machinery:
// the primitive presents the skill to the human and blocks until a yes/no
// answer arrives or the timeout expires. A `yes` answer moves the skill
// from `skills_quarantine/<slug>/` → `skills/<slug>/`. A `no` answer
// rejects (deletes) it. Ambiguous answers leave the skill in quarantine.
//
// This preserves Moxxy's "agent proposes, human disposes" governance: the
// agent never unilaterally approves its own skills.
// ---------------------------------------------------------------------------

pub struct SkillRequestApprovalPrimitive {
    event_bus: EventBus,
    ask_channels: AskChannels,
    agent_id: String,
    agent_dir: PathBuf,
}

impl SkillRequestApprovalPrimitive {
    pub fn new(
        event_bus: EventBus,
        ask_channels: AskChannels,
        agent_id: String,
        agent_dir: PathBuf,
    ) -> Self {
        Self {
            event_bus,
            ask_channels,
            agent_id,
            agent_dir,
        }
    }
}

/// Parse a free-form answer string into an approval decision. We accept a
/// small set of unambiguous tokens; anything else leaves the skill in
/// quarantine (safer default — the human can always call the REST endpoint).
fn parse_approval_answer(answer: &str) -> ApprovalDecision {
    let trimmed = answer.trim().to_lowercase();
    match trimmed.as_str() {
        "yes" | "y" | "approve" | "approved" | "ok" | "true" | "1" => ApprovalDecision::Approve,
        "no" | "n" | "reject" | "rejected" | "deny" | "denied" | "false" | "0" => {
            ApprovalDecision::Reject
        }
        _ => ApprovalDecision::Ambiguous,
    }
}

#[derive(Debug, PartialEq, Eq)]
enum ApprovalDecision {
    Approve,
    Reject,
    Ambiguous,
}

#[async_trait]
impl Primitive for SkillRequestApprovalPrimitive {
    fn name(&self) -> &str {
        "skill.request_approval"
    }

    fn description(&self) -> &str {
        "Request human approval to promote a quarantined (auto-synthesized) skill into the active tool catalog. The agent pauses until the user answers yes/no. This is the ONLY way for an agent to approve its own synthesized skills — a 'yes' answer moves the skill from skills_quarantine/<slug>/ to skills/<slug>/; a 'no' answer rejects and deletes it."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "slug": {
                    "type": "string",
                    "description": "Slug of the quarantined skill to request approval for (from skills_quarantine/<slug>/SKILL.md)"
                },
                "rationale": {
                    "type": "string",
                    "description": "Optional short explanation of why this skill is worth approving, shown to the user with the prompt."
                },
                "timeout_seconds": {
                    "type": "integer",
                    "description": "How long to wait for an answer (default: 600)"
                }
            },
            "required": ["slug"]
        })
    }

    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        let slug = params
            .get("slug")
            .and_then(|v| v.as_str())
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'slug'".into()))?
            .to_string();
        let rationale = params
            .get("rationale")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let timeout_seconds = params
            .get("timeout_seconds")
            .and_then(|v| v.as_u64())
            .unwrap_or(600);

        // Load the quarantined skill to confirm existence + show details.
        let quarantine_dir = self.agent_dir.join("skills_quarantine").join(&slug);
        let skill_md_path = quarantine_dir.join("SKILL.md");
        if !skill_md_path.is_file() {
            return Err(PrimitiveError::NotFound(format!(
                "quarantined skill '{slug}' not found (looked at {})",
                skill_md_path.display()
            )));
        }
        let skill_content = std::fs::read_to_string(&skill_md_path)
            .map_err(|e| PrimitiveError::ExecutionFailed(e.to_string()))?;
        let doc = SkillDoc::parse(&skill_content)
            .map_err(|e| PrimitiveError::InvalidParams(e.to_string()))?;

        // Format a clear approval prompt.
        let allowed = if doc.allowed_primitives.is_empty() {
            "(none specified)".to_string()
        } else {
            doc.allowed_primitives.join(", ")
        };
        let mut question = format!(
            "I synthesized a new skill and want to add it to my active toolkit:\n\n\
             • Name: {}\n\
             • Description: {}\n\
             • Version: {}\n\
             • Author: {}\n\
             • Allowed primitives: {}\n",
            doc.name, doc.description, doc.version, doc.author, allowed
        );
        if !rationale.trim().is_empty() {
            question.push_str(&format!(
                "\nWhy I think it's useful: {}\n",
                rationale.trim()
            ));
        }
        question.push_str(
            "\nApprove it? Reply 'yes' to move it into my active skills, 'no' to reject and delete it, or anything else to leave it pending.",
        );

        let question_id = uuid::Uuid::now_v7().to_string();

        tracing::info!(
            agent_id = %self.agent_id,
            %question_id,
            %slug,
            "Agent requesting approval for quarantined skill"
        );

        // Emit a targeted event BEFORE the generic UserAskQuestion so observers
        // can distinguish skill-approval prompts from normal questions.
        self.event_bus.emit(EventEnvelope::new(
            self.agent_id.clone(),
            None,
            None,
            0,
            EventType::SkillApprovalRequested,
            serde_json::json!({
                "question_id": question_id,
                "slug": slug,
                "skill_name": doc.name,
                "description": doc.description,
                "author": doc.author,
                "allowed_primitives": doc.allowed_primitives,
            }),
        ));

        // Reuse the user.ask oneshot plumbing.
        let (tx, rx) = tokio::sync::oneshot::channel::<String>();
        {
            let mut channels = self
                .ask_channels
                .lock()
                .map_err(|_| PrimitiveError::ExecutionFailed("lock poisoned".into()))?;
            channels.insert(question_id.clone(), tx);
        }
        self.event_bus.emit(EventEnvelope::new(
            self.agent_id.clone(),
            None,
            None,
            0,
            EventType::UserAskQuestion,
            serde_json::json!({
                "question_id": question_id,
                "question": question,
                "context": "skill_approval",
                "slug": slug,
            }),
        ));

        let timeout = std::time::Duration::from_secs(timeout_seconds);
        let answer = match tokio::time::timeout(timeout, rx).await {
            Ok(Ok(a)) => a,
            Ok(Err(_)) => {
                self.cleanup_channel(&question_id);
                return Err(PrimitiveError::ExecutionFailed(
                    "approval channel closed without response".into(),
                ));
            }
            Err(_) => {
                self.cleanup_channel(&question_id);
                return Err(PrimitiveError::Timeout);
            }
        };

        self.event_bus.emit(EventEnvelope::new(
            self.agent_id.clone(),
            None,
            None,
            0,
            EventType::UserAskAnswered,
            serde_json::json!({"question_id": question_id}),
        ));

        match parse_approval_answer(&answer) {
            ApprovalDecision::Approve => {
                let promoted = SkillLoader::approve_quarantined(&self.agent_dir, &slug)
                    .map_err(|e| PrimitiveError::ExecutionFailed(e.to_string()))?;
                self.event_bus.emit(EventEnvelope::new(
                    self.agent_id.clone(),
                    None,
                    None,
                    0,
                    EventType::SkillApproved,
                    serde_json::json!({
                        "slug": slug,
                        "skill_name": doc.name,
                        "path": promoted.display().to_string(),
                        "approved_by": "user",
                    }),
                ));
                tracing::info!(agent_id = %self.agent_id, %slug, "Skill approved by user");
                Ok(serde_json::json!({
                    "status": "approved",
                    "slug": slug,
                    "path": promoted.display().to_string(),
                }))
            }
            ApprovalDecision::Reject => {
                SkillLoader::reject_quarantined(&self.agent_dir, &slug)
                    .map_err(|e| PrimitiveError::ExecutionFailed(e.to_string()))?;
                self.event_bus.emit(EventEnvelope::new(
                    self.agent_id.clone(),
                    None,
                    None,
                    0,
                    EventType::SkillApprovalDenied,
                    serde_json::json!({
                        "slug": slug,
                        "skill_name": doc.name,
                        "outcome": "rejected_and_deleted",
                    }),
                ));
                tracing::info!(agent_id = %self.agent_id, %slug, "Skill rejected by user");
                Ok(serde_json::json!({
                    "status": "rejected",
                    "slug": slug,
                }))
            }
            ApprovalDecision::Ambiguous => {
                self.event_bus.emit(EventEnvelope::new(
                    self.agent_id.clone(),
                    None,
                    None,
                    0,
                    EventType::SkillApprovalDenied,
                    serde_json::json!({
                        "slug": slug,
                        "skill_name": doc.name,
                        "outcome": "ambiguous_answer_left_in_quarantine",
                        "answer": answer,
                    }),
                ));
                tracing::info!(
                    agent_id = %self.agent_id,
                    %slug,
                    answer = %answer,
                    "Ambiguous approval answer — skill left in quarantine"
                );
                Ok(serde_json::json!({
                    "status": "pending",
                    "slug": slug,
                    "reason": "ambiguous_answer",
                    "answer": answer,
                }))
            }
        }
    }
}

impl SkillRequestApprovalPrimitive {
    fn cleanup_channel(&self, question_id: &str) {
        if let Ok(mut channels) = self.ask_channels.lock() {
            channels.remove(question_id);
        }
    }
}

// ---------------------------------------------------------------------------
// skill.patch — iterative self-editing of auto-synthesized skills.
//
// The agent can only patch skills whose frontmatter `author` field starts
// with `auto-synthesized:<this_agent_name>` — this prevents agents from
// modifying builtin skills, human-authored skills, or another agent's
// skills. Patches preserve frontmatter, bump the version patch-level, and
// snapshot the previous SKILL.md into `<skill_dir>/.history/<ts>.md` for
// audit.
//
// Two operations:
//   - `append`: append `content` to the body (most common use)
//   - `replace_body`: replace entire body (frontmatter preserved)
//
// Both re-parse through SkillDoc::parse to fail closed on malformed output.
// ---------------------------------------------------------------------------

pub struct SkillPatchPrimitive {
    event_bus: EventBus,
    agent_id: String,
    agent_dir: PathBuf,
    history_max_versions: u32,
}

impl SkillPatchPrimitive {
    pub fn new(event_bus: EventBus, agent_id: String, agent_dir: PathBuf) -> Self {
        Self {
            event_bus,
            agent_id,
            agent_dir,
            history_max_versions: 10,
        }
    }

    pub fn with_history_max_versions(mut self, n: u32) -> Self {
        self.history_max_versions = n;
        self
    }
}

/// Keep only the most recent `max` snapshots in `.history/`. Filenames are
/// RFC-3339-like ISO timestamps so lexicographic sort = chronological sort.
fn prune_skill_history(history_dir: &std::path::Path, max: u32) {
    if max == 0 {
        return;
    }
    let Ok(entries) = std::fs::read_dir(history_dir) else {
        return;
    };
    let mut files: Vec<std::path::PathBuf> = entries
        .flatten()
        .filter(|e| e.path().extension().and_then(|s| s.to_str()) == Some("md"))
        .map(|e| e.path())
        .collect();
    if files.len() <= max as usize {
        return;
    }
    files.sort(); // ascending by filename (= by timestamp)
    let to_drop = files.len() - max as usize;
    for path in files.iter().take(to_drop) {
        let _ = std::fs::remove_file(path);
    }
}

/// Bump the patch-level of a semver-ish version string. `0.1.0` → `0.1.1`,
/// `1.2.3` → `1.2.4`. Non-numeric suffixes preserved. Unparseable versions
/// return the original unchanged (safer than failing the patch).
fn bump_patch_version(v: &str) -> String {
    let parts: Vec<&str> = v.split('.').collect();
    if parts.len() != 3 {
        return v.to_string();
    }
    let last = parts[2];
    // Split numeric prefix from any suffix (e.g. "3-beta" → 3 + "-beta")
    let (num_str, suffix) = last
        .find(|c: char| !c.is_ascii_digit())
        .map(|i| (&last[..i], &last[i..]))
        .unwrap_or((last, ""));
    let Ok(n) = num_str.parse::<u32>() else {
        return v.to_string();
    };
    format!("{}.{}.{}{}", parts[0], parts[1], n + 1, suffix)
}

/// Re-render frontmatter lines from a SkillDoc plus any custom lines we want
/// to preserve/add. We keep this narrow — only the fields SkillDoc actually
/// surfaces — and let future provenance extensions go through new fields.
fn render_frontmatter(
    doc: &SkillDoc,
    new_version: &str,
    last_patched_at: &str,
    original_frontmatter_extra: &str,
) -> String {
    let mut fm = String::from("---\n");
    fm.push_str(&format!("name: {}\n", doc.name));
    // Escape embedded newlines in description, unlikely but possible.
    fm.push_str(&format!(
        "description: {}\n",
        doc.description.replace('\n', " ")
    ));
    fm.push_str(&format!("author: {}\n", doc.author));
    fm.push_str(&format!("version: \"{new_version}\"\n"));
    if !doc.allowed_primitives.is_empty() {
        fm.push_str("allowed_primitives:\n");
        for p in &doc.allowed_primitives {
            fm.push_str(&format!("  - {p}\n"));
        }
    }
    // Extra lines carried over verbatim (provenance like source_run_id,
    // synthesized_at, status). Trim trailing newline then add back.
    let extra = original_frontmatter_extra.trim_end_matches('\n');
    if !extra.is_empty() {
        fm.push_str(extra);
        fm.push('\n');
    }
    fm.push_str(&format!("last_patched_at: {last_patched_at}\n"));
    fm.push_str("---\n");
    fm
}

/// Extract the frontmatter lines that SkillDoc doesn't surface (provenance
/// markers, etc.) so we can preserve them across patches.
fn extract_extra_frontmatter(raw: &str) -> String {
    let trimmed = raw.trim_start_matches('\n');
    let Some(rest) = trimmed.strip_prefix("---\n") else {
        return String::new();
    };
    let Some(end) = rest.find("\n---\n") else {
        return String::new();
    };
    let fm = &rest[..end];
    // Lines we already generate; filter these out.
    let own_prefixes = [
        "name:",
        "description:",
        "author:",
        "version:",
        "allowed_primitives:",
        "  -",
        "last_patched_at:",
        "inputs_schema:",
        "safety_notes:",
    ];
    fm.lines()
        .filter(|line| {
            let t = line.trim_start();
            !own_prefixes.iter().any(|p| t.starts_with(p))
        })
        .collect::<Vec<_>>()
        .join("\n")
}

#[async_trait]
impl Primitive for SkillPatchPrimitive {
    fn name(&self) -> &str {
        "skill.patch"
    }

    fn description(&self) -> &str {
        "Iteratively edit a skill YOU previously authored (author must start with 'auto-synthesized:<your_name>'). Ops: 'append' adds content to the body; 'replace_body' replaces the body. Frontmatter is preserved, version is patch-bumped, previous version is snapshotted to .history/<ts>.md."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "Skill name or slug to patch"},
                "op": {
                    "type": "string",
                    "enum": ["append", "replace_body"],
                    "description": "Patch operation"
                },
                "content": {
                    "type": "string",
                    "description": "Content to append (op=append) or full new body (op=replace_body)"
                },
                "reason": {
                    "type": "string",
                    "description": "Short explanation of why the patch is needed (recorded in event + history marker)"
                }
            },
            "required": ["name", "op", "content"]
        })
    }

    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        let name = params
            .get("name")
            .and_then(|v| v.as_str())
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'name'".into()))?
            .to_string();
        let op = params
            .get("op")
            .and_then(|v| v.as_str())
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'op'".into()))?
            .to_string();
        let content = params
            .get("content")
            .and_then(|v| v.as_str())
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'content'".into()))?
            .to_string();
        let reason = params
            .get("reason")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        // Find the skill in the agent's active skills dir. We deliberately
        // do NOT look in quarantine (those should be re-synthesized) or
        // builtins (never editable by agents).
        let agent_skills_dir = self.agent_dir.join("skills");
        let loaded = SkillLoader::load_agent(&self.agent_dir);
        let skill = loaded
            .iter()
            .find(|s| {
                let slug = s.doc.slug();
                s.doc.name.to_lowercase() == name.to_lowercase() || slug == name
            })
            .ok_or_else(|| {
                PrimitiveError::NotFound(format!(
                    "active skill '{name}' not found — can only patch your own active skills"
                ))
            })?;

        // Authorization: only patch skills authored by THIS agent's
        // auto-synthesis. Human-authored and builtin skills are off limits.
        let expected_prefix = format!("auto-synthesized:{}", self.agent_id);
        if skill.doc.author != expected_prefix {
            return Err(PrimitiveError::InvalidParams(format!(
                "skill '{}' was not authored by this agent (author='{}', expected prefix '{}')",
                skill.doc.name, skill.doc.author, expected_prefix
            )));
        }

        let skill_dir = agent_skills_dir.join(skill.doc.slug());
        let skill_md = skill_dir.join("SKILL.md");
        let raw = std::fs::read_to_string(&skill_md)
            .map_err(|e| PrimitiveError::ExecutionFailed(format!("read SKILL.md: {e}")))?;

        // Snapshot current version into .history/<ts>.md BEFORE mutating.
        let history_dir = skill_dir.join(".history");
        std::fs::create_dir_all(&history_dir)
            .map_err(|e| PrimitiveError::ExecutionFailed(format!("create history dir: {e}")))?;
        let snapshot_ts = chrono::Utc::now().format("%Y%m%dT%H%M%S%3fZ").to_string();
        let snapshot_path = history_dir.join(format!("{snapshot_ts}.md"));
        std::fs::write(&snapshot_path, &raw)
            .map_err(|e| PrimitiveError::ExecutionFailed(format!("write history snapshot: {e}")))?;

        // Cap history — we want a rolling window, not unbounded growth.
        prune_skill_history(&history_dir, self.history_max_versions);

        // Compute new body based on op.
        let new_body = match op.as_str() {
            "append" => {
                let mut b = skill.doc.body.clone();
                if !b.ends_with('\n') {
                    b.push('\n');
                }
                b.push_str(&content);
                b
            }
            "replace_body" => content.clone(),
            other => {
                return Err(PrimitiveError::InvalidParams(format!(
                    "unknown op '{other}' (expected 'append' or 'replace_body')"
                )));
            }
        };

        // Compose new SKILL.md with bumped version and preserved provenance.
        let new_version = bump_patch_version(&skill.doc.version);
        let ts = chrono::Utc::now().to_rfc3339();
        let extra = extract_extra_frontmatter(&raw);
        let new_fm = render_frontmatter(&skill.doc, &new_version, &ts, &extra);
        let body_with_leading_newline = if new_body.starts_with('\n') {
            new_body.clone()
        } else {
            format!("\n{new_body}")
        };
        let new_content = format!("{new_fm}{body_with_leading_newline}");

        // Fail closed on malformed frontmatter composition.
        SkillDoc::parse(&new_content).map_err(|e| {
            PrimitiveError::ExecutionFailed(format!("composed SKILL.md failed to parse: {e}"))
        })?;

        std::fs::write(&skill_md, &new_content)
            .map_err(|e| PrimitiveError::ExecutionFailed(format!("write SKILL.md: {e}")))?;

        self.event_bus.emit(EventEnvelope::new(
            self.agent_id.clone(),
            None,
            None,
            0,
            EventType::SkillPatched,
            serde_json::json!({
                "slug": skill.doc.slug(),
                "skill_name": skill.doc.name,
                "op": op,
                "new_version": new_version,
                "previous_version": skill.doc.version,
                "history_snapshot": snapshot_path.display().to_string(),
                "reason": reason,
            }),
        ));

        tracing::info!(
            agent_id = %self.agent_id,
            slug = %skill.doc.slug(),
            op = %op,
            new_version = %new_version,
            "Skill patched"
        );

        Ok(serde_json::json!({
            "status": "patched",
            "slug": skill.doc.slug(),
            "name": skill.doc.name,
            "op": op,
            "previous_version": skill.doc.version,
            "new_version": new_version,
            "history_snapshot": snapshot_path.display().to_string(),
        }))
    }
}

// ---------------------------------------------------------------------------
// skill.remove
// ---------------------------------------------------------------------------

pub struct SkillRemovePrimitive {
    agent_skills_dir: PathBuf,
}

impl SkillRemovePrimitive {
    pub fn new(agent_skills_dir: PathBuf) -> Self {
        Self { agent_skills_dir }
    }
}

#[async_trait]
impl Primitive for SkillRemovePrimitive {
    fn name(&self) -> &str {
        "skill.remove"
    }

    fn description(&self) -> &str {
        "Remove an agent-specific skill by name. Built-in skills cannot be removed."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "Name of the skill to remove"}
            },
            "required": ["name"]
        })
    }

    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        let name = params["name"]
            .as_str()
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'name' parameter".into()))?;

        // Derive slug from name to find the directory
        let slug = name
            .to_lowercase()
            .chars()
            .map(|c| if c.is_alphanumeric() { c } else { '-' })
            .collect::<String>()
            .split('-')
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join("-");

        let skill_dir = self.agent_skills_dir.join(&slug);
        if !skill_dir.exists() {
            return Err(PrimitiveError::InvalidParams(format!(
                "skill '{}' not found in agent skills",
                name
            )));
        }

        std::fs::remove_dir_all(&skill_dir)
            .map_err(|e| PrimitiveError::ExecutionFailed(format!("failed to remove skill: {e}")))?;

        tracing::info!(name, slug, "Agent skill removed");

        Ok(serde_json::json!({
            "status": "removed",
            "name": name,
        }))
    }
}

// ---------------------------------------------------------------------------
// Shared helper
// ---------------------------------------------------------------------------

/// Find a skill by name or slug, checking agent skills first then builtins.
fn find_skill_by_name(
    moxxy_home: &std::path::Path,
    agent_dir: &std::path::Path,
    name: &str,
) -> Result<moxxy_core::LoadedSkill, PrimitiveError> {
    let name_lower = name.to_lowercase();
    let name_slug = name
        .to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("-");

    // Check agent skills first (override builtins)
    let agent_skills = SkillLoader::load_agent(agent_dir);
    for skill in agent_skills {
        if skill.doc.slug() == name_slug || skill.doc.name.to_lowercase() == name_lower {
            return Ok(skill);
        }
    }

    // Then check builtins
    let builtin_skills = SkillLoader::load_builtin(moxxy_home);
    for skill in builtin_skills {
        if skill.doc.slug() == name_slug || skill.doc.name.to_lowercase() == name_lower {
            return Ok(skill);
        }
    }

    Err(PrimitiveError::InvalidParams(format!(
        "skill '{}' not found",
        name
    )))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn valid_skill_content(name: &str) -> String {
        format!(
            "---\nname: {name}\ndescription: A skill called {name}\nauthor: tester\nversion: \"1.0\"\n---\n# {name}\nBody for {name}"
        )
    }

    fn skill_with_schema(name: &str) -> String {
        format!(
            "---\nname: {name}\ndescription: A skill with inputs\nauthor: tester\nversion: \"1.0\"\ninputs_schema:\n  type: object\n  required:\n    - url\n  properties:\n    url:\n      type: string\n---\n# {name}\nFetch the URL: {{{{url}}}}"
        )
    }

    fn write_skill(dir: &std::path::Path, slug: &str, content: &str) {
        let skill_dir = dir.join("skills").join(slug);
        std::fs::create_dir_all(&skill_dir).unwrap();
        std::fs::write(skill_dir.join("SKILL.md"), content).unwrap();
    }

    // ---- skill.create tests ----

    #[tokio::test]
    async fn skill_create_writes_skill_md() {
        let tmp = TempDir::new().unwrap();
        let skills_dir = tmp.path().join("skills");
        let prim = SkillCreatePrimitive::new(
            skills_dir.clone(),
            tmp.path().to_path_buf(),
            tmp.path().to_path_buf(),
        );

        let content = valid_skill_content("my-skill");
        let result = prim
            .invoke(serde_json::json!({ "content": content }))
            .await
            .unwrap();

        assert_eq!(result["status"], "created");
        assert_eq!(result["name"], "my-skill");
        assert_eq!(result["slug"], "my-skill");
        assert!(skills_dir.join("my-skill").join("SKILL.md").exists());
    }

    #[tokio::test]
    async fn skill_create_rejects_invalid_content() {
        let tmp = TempDir::new().unwrap();
        let prim = SkillCreatePrimitive::new(
            tmp.path().join("skills"),
            tmp.path().to_path_buf(),
            tmp.path().to_path_buf(),
        );

        let result = prim
            .invoke(serde_json::json!({ "content": "no frontmatter" }))
            .await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn skill_create_rejects_duplicate_slug() {
        let tmp = TempDir::new().unwrap();
        let skills_dir = tmp.path().join("skills");
        // Write an existing skill
        write_skill(tmp.path(), "my-skill", &valid_skill_content("my-skill"));

        let prim = SkillCreatePrimitive::new(
            skills_dir,
            tmp.path().to_path_buf(),
            tmp.path().to_path_buf(),
        );

        let content = valid_skill_content("my-skill");
        let result = prim.invoke(serde_json::json!({ "content": content })).await;
        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(err.contains("already exists"));
    }

    // ---- skill.validate tests ----

    #[tokio::test]
    async fn skill_validate_checks_frontmatter() {
        let prim = SkillValidatePrimitive::new();
        let result = prim
            .invoke(serde_json::json!({
                "content": "no frontmatter here"
            }))
            .await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn skill_validate_succeeds_for_valid_doc() {
        let prim = SkillValidatePrimitive::new();
        let result = prim
            .invoke(serde_json::json!({
                "content": "---\nname: Test\ndescription: A test skill\nauthor: me\nversion: \"1.0\"\n---\nBody"
            }))
            .await
            .unwrap();
        assert_eq!(result["valid"], true);
        assert_eq!(result["name"].as_str().unwrap(), "Test");
        assert_eq!(result["slug"].as_str().unwrap(), "test");
    }

    // ---- skill.list tests ----

    #[tokio::test]
    async fn skill_list_returns_only_agent_skills() {
        let home = TempDir::new().unwrap();
        let agent = TempDir::new().unwrap();

        // Write a builtin skill (should NOT appear)
        write_skill(home.path(), "b1", &valid_skill_content("b1"));

        // Write an agent skill (should appear)
        write_skill(agent.path(), "a1", &valid_skill_content("a1"));

        let prim = SkillListPrimitive::new(agent.path().to_path_buf());
        let result = prim.invoke(serde_json::json!({})).await.unwrap();
        let skills = result["skills"].as_array().unwrap();
        assert_eq!(skills.len(), 1);
        assert_eq!(skills[0]["name"], "a1");
    }

    // ---- skill.find tests ----

    #[tokio::test]
    async fn skill_find_matches_by_name_and_description() {
        let home = TempDir::new().unwrap();
        let agent = TempDir::new().unwrap();

        write_skill(
            home.path(),
            "web-scraper",
            "---\nname: Web Scraper\ndescription: Scrapes web pages for data extraction\nauthor: tester\nversion: \"1.0\"\n---\nBody",
        );
        write_skill(
            agent.path(),
            "deploy",
            "---\nname: Deploy\ndescription: Deploy application to production\nauthor: tester\nversion: \"1.0\"\n---\nBody",
        );

        let prim = SkillFindPrimitive::new(home.path().to_path_buf(), agent.path().to_path_buf());

        // Search for "web"
        let result = prim
            .invoke(serde_json::json!({ "query": "web scrape" }))
            .await
            .unwrap();
        let skills = result["skills"].as_array().unwrap();
        assert_eq!(skills.len(), 1);
        assert_eq!(skills[0]["name"], "Web Scraper");
    }

    #[tokio::test]
    async fn skill_find_returns_empty_for_no_match() {
        let home = TempDir::new().unwrap();
        let agent = TempDir::new().unwrap();

        let prim = SkillFindPrimitive::new(home.path().to_path_buf(), agent.path().to_path_buf());
        let result = prim
            .invoke(serde_json::json!({ "query": "nonexistent" }))
            .await
            .unwrap();
        let skills = result["skills"].as_array().unwrap();
        assert!(skills.is_empty());
    }

    // ---- skill.get tests ----

    #[tokio::test]
    async fn skill_get_returns_full_content() {
        let home = TempDir::new().unwrap();
        let agent = TempDir::new().unwrap();

        write_skill(
            agent.path(),
            "my-tool",
            "---\nname: My Tool\ndescription: Does things\nauthor: tester\nversion: \"2.0\"\nallowed_primitives:\n  - fs.read\n---\n# Instructions\nDo the thing.",
        );

        let prim = SkillGetPrimitive::new(home.path().to_path_buf(), agent.path().to_path_buf());
        let result = prim
            .invoke(serde_json::json!({ "name": "My Tool" }))
            .await
            .unwrap();

        assert_eq!(result["name"], "My Tool");
        assert_eq!(result["version"], "2.0");
        assert_eq!(result["allowed_primitives"][0], "fs.read");
        assert!(result["body"].as_str().unwrap().contains("Do the thing"));
    }

    #[tokio::test]
    async fn skill_get_not_found() {
        let home = TempDir::new().unwrap();
        let agent = TempDir::new().unwrap();

        let prim = SkillGetPrimitive::new(home.path().to_path_buf(), agent.path().to_path_buf());
        let result = prim
            .invoke(serde_json::json!({ "name": "nonexistent" }))
            .await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("not found"));
    }

    // ---- skill.execute tests ----

    #[tokio::test]
    async fn skill_execute_success_with_inputs() {
        let home = TempDir::new().unwrap();
        let agent = TempDir::new().unwrap();

        write_skill(agent.path(), "fetcher", &skill_with_schema("Fetcher"));

        let prim =
            SkillExecutePrimitive::new(home.path().to_path_buf(), agent.path().to_path_buf());
        let result = prim
            .invoke(serde_json::json!({
                "name": "Fetcher",
                "inputs": { "url": "https://example.com" }
            }))
            .await
            .unwrap();

        assert_eq!(result["name"], "Fetcher");
        assert_eq!(result["inputs"]["url"], "https://example.com");
        assert!(
            result["instructions"]
                .as_str()
                .unwrap()
                .contains("Fetch the URL")
        );
    }

    #[tokio::test]
    async fn skill_execute_missing_required_input_returns_warning() {
        let home = TempDir::new().unwrap();
        let agent = TempDir::new().unwrap();

        write_skill(agent.path(), "fetcher", &skill_with_schema("Fetcher"));

        let prim =
            SkillExecutePrimitive::new(home.path().to_path_buf(), agent.path().to_path_buf());
        let result = prim
            .invoke(serde_json::json!({
                "name": "Fetcher",
                "inputs": {}
            }))
            .await
            .unwrap();

        // Should still return instructions, but with a warning
        assert_eq!(result["name"], "Fetcher");
        assert!(result["instructions"].as_str().is_some());
        let missing = result["missing_inputs"].as_array().unwrap();
        assert_eq!(missing.len(), 1);
        assert_eq!(missing[0], "url");
        assert!(result["warning"].as_str().unwrap().contains("url"));
    }

    #[tokio::test]
    async fn skill_execute_no_schema_succeeds() {
        let home = TempDir::new().unwrap();
        let agent = TempDir::new().unwrap();

        write_skill(agent.path(), "simple", &valid_skill_content("Simple"));

        let prim =
            SkillExecutePrimitive::new(home.path().to_path_buf(), agent.path().to_path_buf());
        let result = prim
            .invoke(serde_json::json!({ "name": "Simple" }))
            .await
            .unwrap();

        assert_eq!(result["name"], "Simple");
    }

    // ---- skill.remove tests ----

    #[tokio::test]
    async fn skill_remove_deletes_agent_skill() {
        let tmp = TempDir::new().unwrap();
        let skills_dir = tmp.path().join("skills");

        // Create first
        let create = SkillCreatePrimitive::new(
            skills_dir.clone(),
            tmp.path().to_path_buf(),
            tmp.path().to_path_buf(),
        );
        create
            .invoke(serde_json::json!({ "content": valid_skill_content("rm-me") }))
            .await
            .unwrap();
        assert!(skills_dir.join("rm-me").join("SKILL.md").exists());

        // Remove
        let remove = SkillRemovePrimitive::new(skills_dir.clone());
        let result = remove
            .invoke(serde_json::json!({ "name": "rm-me" }))
            .await
            .unwrap();
        assert_eq!(result["status"], "removed");
        assert!(!skills_dir.join("rm-me").exists());
    }

    // ---- skill.patch tests ----

    fn auto_synthesized_skill(agent: &str, slug: &str) -> String {
        format!(
            "---\nname: {slug}\ndescription: A self-edited skill\nauthor: auto-synthesized:{agent}\nversion: \"0.1.0\"\nsource_run_id: run-1\nstatus: approved\n---\n# Instructions\nStep 1."
        )
    }

    #[test]
    fn bump_patch_version_happy_path() {
        assert_eq!(super::bump_patch_version("0.1.0"), "0.1.1");
        assert_eq!(super::bump_patch_version("1.2.3"), "1.2.4");
        assert_eq!(super::bump_patch_version("0.1.9"), "0.1.10");
    }

    #[test]
    fn bump_patch_version_passes_through_non_semver() {
        assert_eq!(super::bump_patch_version("weird"), "weird");
        assert_eq!(super::bump_patch_version("1.2"), "1.2");
    }

    #[test]
    fn extract_extra_frontmatter_keeps_provenance() {
        let raw = "---\nname: x\ndescription: y\nauthor: z\nversion: \"1.0\"\nsource_run_id: run-1\nstatus: approved\n---\nbody";
        let extra = super::extract_extra_frontmatter(raw);
        assert!(extra.contains("source_run_id: run-1"));
        assert!(extra.contains("status: approved"));
        assert!(!extra.contains("name:"));
    }

    #[tokio::test]
    async fn patch_append_bumps_version_and_snapshots() {
        use moxxy_core::EventBus;

        let tmp = TempDir::new().unwrap();
        let agent_dir = tmp.path();
        write_skill(
            agent_dir,
            "self-skill",
            &auto_synthesized_skill("alice", "self-skill"),
        );

        let bus = EventBus::new(100);
        let prim = SkillPatchPrimitive::new(bus, "alice".into(), agent_dir.to_path_buf());

        let result = prim
            .invoke(serde_json::json!({
                "name": "self-skill",
                "op": "append",
                "content": "Step 2.\n",
                "reason": "Added missing step discovered at runtime"
            }))
            .await
            .unwrap();

        assert_eq!(result["status"], "patched");
        assert_eq!(result["new_version"], "0.1.1");
        assert_eq!(result["previous_version"], "0.1.0");

        // Body should now contain both steps
        let skill_md =
            std::fs::read_to_string(agent_dir.join("skills").join("self-skill").join("SKILL.md"))
                .unwrap();
        assert!(skill_md.contains("Step 1."));
        assert!(skill_md.contains("Step 2."));
        assert!(skill_md.contains("version: \"0.1.1\""));
        assert!(skill_md.contains("last_patched_at:"));
        // Provenance preserved
        assert!(skill_md.contains("source_run_id: run-1"));

        // History snapshot exists
        let history_dir = agent_dir.join("skills").join("self-skill").join(".history");
        assert!(history_dir.is_dir());
        let entries: Vec<_> = std::fs::read_dir(&history_dir).unwrap().collect();
        assert_eq!(entries.len(), 1);
    }

    #[tokio::test]
    async fn patch_replace_body_preserves_frontmatter() {
        use moxxy_core::EventBus;

        let tmp = TempDir::new().unwrap();
        let agent_dir = tmp.path();
        write_skill(
            agent_dir,
            "replace-me",
            &auto_synthesized_skill("alice", "replace-me"),
        );

        let bus = EventBus::new(100);
        let prim = SkillPatchPrimitive::new(bus, "alice".into(), agent_dir.to_path_buf());

        prim.invoke(serde_json::json!({
            "name": "replace-me",
            "op": "replace_body",
            "content": "# Completely new instructions\nDo it this way instead.",
        }))
        .await
        .unwrap();

        let skill_md =
            std::fs::read_to_string(agent_dir.join("skills").join("replace-me").join("SKILL.md"))
                .unwrap();
        assert!(skill_md.contains("Do it this way instead"));
        assert!(!skill_md.contains("Step 1."));
        // Frontmatter still intact
        assert!(skill_md.contains("author: auto-synthesized:alice"));
        assert!(skill_md.contains("source_run_id: run-1"));
    }

    #[tokio::test]
    async fn patch_rejects_human_authored_skill() {
        use moxxy_core::EventBus;

        let tmp = TempDir::new().unwrap();
        let agent_dir = tmp.path();
        // Human-authored skill
        write_skill(
            agent_dir,
            "human-skill",
            &valid_skill_content("human-skill"),
        );

        let bus = EventBus::new(100);
        let prim = SkillPatchPrimitive::new(bus, "alice".into(), agent_dir.to_path_buf());

        let result = prim
            .invoke(serde_json::json!({
                "name": "human-skill",
                "op": "append",
                "content": "malicious content",
            }))
            .await;
        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(err.contains("not authored by this agent"));
    }

    #[tokio::test]
    async fn patch_rejects_other_agents_skill() {
        use moxxy_core::EventBus;

        let tmp = TempDir::new().unwrap();
        let agent_dir = tmp.path();
        // Skill auto-synthesized by a DIFFERENT agent
        write_skill(
            agent_dir,
            "bobs-skill",
            &auto_synthesized_skill("bob", "bobs-skill"),
        );

        let bus = EventBus::new(100);
        let prim = SkillPatchPrimitive::new(bus, "alice".into(), agent_dir.to_path_buf());

        let result = prim
            .invoke(serde_json::json!({
                "name": "bobs-skill",
                "op": "append",
                "content": "content",
            }))
            .await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn patch_rejects_unknown_op() {
        use moxxy_core::EventBus;

        let tmp = TempDir::new().unwrap();
        let agent_dir = tmp.path();
        write_skill(agent_dir, "s", &auto_synthesized_skill("alice", "s"));

        let bus = EventBus::new(100);
        let prim = SkillPatchPrimitive::new(bus, "alice".into(), agent_dir.to_path_buf());

        let result = prim
            .invoke(serde_json::json!({"name": "s", "op": "delete", "content": "x"}))
            .await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn patch_history_capped_at_max_versions() {
        use moxxy_core::EventBus;

        let tmp = TempDir::new().unwrap();
        let agent_dir = tmp.path();
        write_skill(
            agent_dir,
            "rolling",
            &auto_synthesized_skill("alice", "rolling"),
        );

        let bus = EventBus::new(100);
        let prim = SkillPatchPrimitive::new(bus, "alice".into(), agent_dir.to_path_buf())
            .with_history_max_versions(3);

        for i in 0..6 {
            prim.invoke(serde_json::json!({
                "name": "rolling",
                "op": "append",
                "content": format!("v{i}"),
            }))
            .await
            .unwrap();
            // Ensure distinct timestamps so older snapshots sort first
            tokio::time::sleep(std::time::Duration::from_millis(3)).await;
        }

        let history_dir = agent_dir.join("skills").join("rolling").join(".history");
        let entries: Vec<_> = std::fs::read_dir(&history_dir).unwrap().collect();
        assert_eq!(entries.len(), 3, "history must be capped at 3 snapshots");
    }

    #[tokio::test]
    async fn patch_multiple_times_accumulates_history() {
        use moxxy_core::EventBus;

        let tmp = TempDir::new().unwrap();
        let agent_dir = tmp.path();
        write_skill(
            agent_dir,
            "evolver",
            &auto_synthesized_skill("alice", "evolver"),
        );

        let bus = EventBus::new(100);
        let prim = SkillPatchPrimitive::new(bus, "alice".into(), agent_dir.to_path_buf());

        prim.invoke(serde_json::json!({"name": "evolver", "op": "append", "content": "a"}))
            .await
            .unwrap();
        tokio::time::sleep(std::time::Duration::from_millis(5)).await;
        prim.invoke(serde_json::json!({"name": "evolver", "op": "append", "content": "b"}))
            .await
            .unwrap();

        let history_dir = agent_dir.join("skills").join("evolver").join(".history");
        let entries: Vec<_> = std::fs::read_dir(&history_dir).unwrap().collect();
        assert_eq!(entries.len(), 2);

        let skill_md =
            std::fs::read_to_string(agent_dir.join("skills").join("evolver").join("SKILL.md"))
                .unwrap();
        assert!(skill_md.contains("version: \"0.1.2\""));
    }

    // ---- skill.request_approval tests ----

    fn write_quarantined_skill(agent_dir: &std::path::Path, slug: &str, content: &str) {
        let dir = agent_dir.join("skills_quarantine").join(slug);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("SKILL.md"), content).unwrap();
    }

    #[test]
    fn parse_approval_answer_handles_common_forms() {
        assert_eq!(
            super::parse_approval_answer("yes"),
            super::ApprovalDecision::Approve
        );
        assert_eq!(
            super::parse_approval_answer("Y"),
            super::ApprovalDecision::Approve
        );
        assert_eq!(
            super::parse_approval_answer("  approve  "),
            super::ApprovalDecision::Approve
        );
        assert_eq!(
            super::parse_approval_answer("no"),
            super::ApprovalDecision::Reject
        );
        assert_eq!(
            super::parse_approval_answer("reject"),
            super::ApprovalDecision::Reject
        );
        assert_eq!(
            super::parse_approval_answer("maybe"),
            super::ApprovalDecision::Ambiguous
        );
        assert_eq!(
            super::parse_approval_answer(""),
            super::ApprovalDecision::Ambiguous
        );
    }

    #[tokio::test]
    async fn request_approval_errors_on_unknown_slug() {
        use crate::primitives::ask::new_ask_channels;
        use moxxy_core::EventBus;

        let tmp = TempDir::new().unwrap();
        let channels = new_ask_channels();
        let bus = EventBus::new(100);

        let prim = SkillRequestApprovalPrimitive::new(
            bus,
            channels,
            "alice".into(),
            tmp.path().to_path_buf(),
        );
        let result = prim
            .invoke(serde_json::json!({"slug": "ghost", "timeout_seconds": 1}))
            .await;
        assert!(matches!(result.unwrap_err(), PrimitiveError::NotFound(_)));
    }

    #[tokio::test]
    async fn request_approval_promotes_on_yes() {
        use crate::primitives::ask::{AgentRespondPrimitive, new_ask_channels};
        use moxxy_core::EventBus;

        let tmp = TempDir::new().unwrap();
        let agent_dir = tmp.path();
        write_quarantined_skill(agent_dir, "helper", &valid_skill_content("Helper"));

        let channels = new_ask_channels();
        let bus = EventBus::new(100);

        let ask = SkillRequestApprovalPrimitive::new(
            bus,
            channels.clone(),
            "alice".into(),
            agent_dir.to_path_buf(),
        );
        let respond = AgentRespondPrimitive::new(channels.clone());

        let ask_handle = tokio::spawn(async move {
            ask.invoke(serde_json::json!({"slug": "helper", "timeout_seconds": 5}))
                .await
        });

        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        let qid = channels.lock().unwrap().keys().next().unwrap().clone();
        respond
            .invoke(serde_json::json!({"question_id": qid, "answer": "yes"}))
            .await
            .unwrap();

        let result = ask_handle.await.unwrap().unwrap();
        assert_eq!(result["status"], "approved");
        assert!(
            agent_dir
                .join("skills")
                .join("helper")
                .join("SKILL.md")
                .is_file()
        );
        assert!(!agent_dir.join("skills_quarantine").join("helper").exists());
    }

    #[tokio::test]
    async fn request_approval_deletes_on_no() {
        use crate::primitives::ask::{AgentRespondPrimitive, new_ask_channels};
        use moxxy_core::EventBus;

        let tmp = TempDir::new().unwrap();
        let agent_dir = tmp.path();
        write_quarantined_skill(agent_dir, "spam", &valid_skill_content("Spam"));

        let channels = new_ask_channels();
        let bus = EventBus::new(100);

        let ask = SkillRequestApprovalPrimitive::new(
            bus,
            channels.clone(),
            "alice".into(),
            agent_dir.to_path_buf(),
        );
        let respond = AgentRespondPrimitive::new(channels.clone());

        let ask_handle = tokio::spawn(async move {
            ask.invoke(serde_json::json!({"slug": "spam", "timeout_seconds": 5}))
                .await
        });

        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        let qid = channels.lock().unwrap().keys().next().unwrap().clone();
        respond
            .invoke(serde_json::json!({"question_id": qid, "answer": "no"}))
            .await
            .unwrap();

        let result = ask_handle.await.unwrap().unwrap();
        assert_eq!(result["status"], "rejected");
        assert!(!agent_dir.join("skills_quarantine").join("spam").exists());
        assert!(!agent_dir.join("skills").join("spam").exists());
    }

    #[tokio::test]
    async fn request_approval_leaves_pending_on_ambiguous() {
        use crate::primitives::ask::{AgentRespondPrimitive, new_ask_channels};
        use moxxy_core::EventBus;

        let tmp = TempDir::new().unwrap();
        let agent_dir = tmp.path();
        write_quarantined_skill(agent_dir, "undecided", &valid_skill_content("Undecided"));

        let channels = new_ask_channels();
        let bus = EventBus::new(100);

        let ask = SkillRequestApprovalPrimitive::new(
            bus,
            channels.clone(),
            "alice".into(),
            agent_dir.to_path_buf(),
        );
        let respond = AgentRespondPrimitive::new(channels.clone());

        let ask_handle = tokio::spawn(async move {
            ask.invoke(serde_json::json!({"slug": "undecided", "timeout_seconds": 5}))
                .await
        });

        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        let qid = channels.lock().unwrap().keys().next().unwrap().clone();
        respond
            .invoke(serde_json::json!({"question_id": qid, "answer": "let me think about it"}))
            .await
            .unwrap();

        let result = ask_handle.await.unwrap().unwrap();
        assert_eq!(result["status"], "pending");
        // Still in quarantine — not promoted, not deleted
        assert!(
            agent_dir
                .join("skills_quarantine")
                .join("undecided")
                .join("SKILL.md")
                .is_file()
        );
        assert!(!agent_dir.join("skills").join("undecided").exists());
    }

    #[tokio::test]
    async fn skill_remove_fails_for_missing() {
        let tmp = TempDir::new().unwrap();
        let remove = SkillRemovePrimitive::new(tmp.path().join("skills"));
        let result = remove
            .invoke(serde_json::json!({ "name": "nonexistent" }))
            .await;
        assert!(result.is_err());
    }
}
