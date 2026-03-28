use async_trait::async_trait;
use moxxy_core::{SkillDoc, SkillLoader};
use std::path::PathBuf;

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
