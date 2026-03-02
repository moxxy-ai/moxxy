use std::path::Path;

use chrono::{DateTime, Duration, Utc};

#[derive(Debug, thiserror::Error)]
pub enum CompactionError {
    #[error("Storage error: {0}")]
    Storage(String),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Provider error: {0}")]
    Provider(String),
    #[error("No eligible entries found")]
    NoEligibleEntries,
}

#[derive(Debug, Clone)]
pub struct CompactionConfig {
    pub age_threshold_days: i64,
    pub max_batch_size: usize,
}

impl Default for CompactionConfig {
    fn default() -> Self {
        Self {
            age_threshold_days: 7,
            max_batch_size: 50,
        }
    }
}

#[derive(Debug)]
pub struct CompactionResult {
    pub group_tag: String,
    pub entries_compacted: usize,
    pub summary_path: String,
    pub archived_count: usize,
}

/// Represents a memory entry eligible for compaction
#[derive(Debug, Clone)]
pub struct EligibleEntry {
    pub id: String,
    pub agent_id: String,
    pub markdown_path: String,
    pub tags_json: Option<String>,
    pub created_at: String,
    pub status: String,
}

pub struct MemoryCompactor {
    config: CompactionConfig,
}

impl MemoryCompactor {
    pub fn new(config: CompactionConfig) -> Self {
        Self { config }
    }

    pub fn with_default_config() -> Self {
        Self::new(CompactionConfig::default())
    }

    /// Find entries eligible for compaction:
    /// - status = "active"
    /// - created_at older than age_threshold_days
    ///
    /// Returns entries grouped by their primary tag.
    pub fn find_eligible(
        &self,
        entries: &[EligibleEntry],
        now: DateTime<Utc>,
    ) -> Vec<(String, Vec<EligibleEntry>)> {
        let threshold = now - Duration::days(self.config.age_threshold_days);
        let threshold_str = threshold.to_rfc3339();

        let eligible: Vec<&EligibleEntry> = entries
            .iter()
            .filter(|e| e.status == "active" && e.created_at < threshold_str)
            .collect();

        // Group by primary tag (first tag in tags_json, or "untagged")
        let mut groups: std::collections::HashMap<String, Vec<EligibleEntry>> =
            std::collections::HashMap::new();
        for entry in eligible {
            let primary_tag = Self::extract_primary_tag(&entry.tags_json);
            let group = groups.entry(primary_tag).or_default();
            if group.len() < self.config.max_batch_size {
                group.push(entry.clone());
            }
        }

        groups.into_iter().collect()
    }

    /// Extract primary tag from tags_json
    fn extract_primary_tag(tags_json: &Option<String>) -> String {
        if let Some(json) = tags_json
            && let Ok(tags) = serde_json::from_str::<Vec<String>>(json)
            && let Some(first) = tags.first()
        {
            return first.clone();
        }
        "untagged".to_string()
    }

    /// Build a summarization prompt from memory file contents
    pub fn build_summarization_prompt(&self, contents: &[(String, String)]) -> String {
        let mut prompt = String::from(
            "You are summarizing memory entries for an AI agent. \
             Create a concise factual summary preserving key decisions, \
             facts, and context. Do not add interpretation.\n\n",
        );

        for (path, content) in contents {
            prompt.push_str(&format!("--- Entry: {} ---\n{}\n\n", path, content));
        }

        prompt.push_str("Provide a consolidated summary:");
        prompt
    }

    /// Compact a group of entries:
    /// 1. Read file contents
    /// 2. Build summarization prompt
    /// 3. Call provider for summary (if provided)
    /// 4. Write summary to journal
    /// 5. Archive original files
    /// 6. Return result
    pub async fn compact_group(
        &self,
        entries: &[EligibleEntry],
        group_tag: &str,
        memory_base_dir: &Path,
        archive_dir: &Path,
        summary_provider: Option<&dyn CompactionSummarizer>,
    ) -> Result<CompactionResult, CompactionError> {
        if entries.is_empty() {
            return Err(CompactionError::NoEligibleEntries);
        }

        // 1. Read file contents
        let mut contents = Vec::new();
        for entry in entries {
            let content = std::fs::read_to_string(&entry.markdown_path)
                .unwrap_or_else(|_| format!("[Could not read {}]", entry.markdown_path));
            contents.push((entry.markdown_path.clone(), content));
        }

        // 2. Build prompt
        let prompt = self.build_summarization_prompt(&contents);

        // 3. Get summary
        let summary = if let Some(provider) = summary_provider {
            provider
                .summarize(&prompt)
                .await
                .map_err(CompactionError::Provider)?
        } else {
            // Fallback: concatenate first lines
            contents
                .iter()
                .filter_map(|(_, c)| {
                    c.lines()
                        .find(|l| !l.starts_with("---") && !l.trim().is_empty())
                        .map(|l| l.trim().to_string())
                })
                .collect::<Vec<_>>()
                .join("; ")
        };

        // 4. Write summary to memory_base_dir
        let summary_filename = format!(
            "summary_{}_{}.md",
            group_tag,
            chrono::Utc::now().format("%Y%m%d_%H%M%S")
        );
        let summary_path = memory_base_dir.join(&summary_filename);
        std::fs::create_dir_all(memory_base_dir)?;

        let mut md = String::new();
        md.push_str(&format!(
            "---\ntimestamp: {}\n",
            chrono::Utc::now().to_rfc3339()
        ));
        md.push_str(&format!("tags: [{}, compacted]\n", group_tag));
        md.push_str(&format!("source_count: {}\n", entries.len()));
        md.push_str("---\n\n");
        md.push_str(&summary);
        md.push('\n');
        std::fs::write(&summary_path, &md)?;

        // 5. Archive original files
        std::fs::create_dir_all(archive_dir)?;
        let mut archived = 0;
        for entry in entries {
            let src = std::path::Path::new(&entry.markdown_path);
            if src.exists()
                && let Some(filename) = src.file_name()
            {
                let dest = archive_dir.join(filename);
                std::fs::rename(src, dest).ok();
                archived += 1;
            }
        }

        Ok(CompactionResult {
            group_tag: group_tag.to_string(),
            entries_compacted: entries.len(),
            summary_path: summary_path.to_string_lossy().to_string(),
            archived_count: archived,
        })
    }
}

/// Trait for providing summarization (can be backed by an LLM Provider)
#[async_trait::async_trait]
pub trait CompactionSummarizer: Send + Sync {
    async fn summarize(&self, prompt: &str) -> Result<String, String>;
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn make_entry(
        id: &str,
        tags_json: Option<&str>,
        created_at: &str,
        status: &str,
    ) -> EligibleEntry {
        EligibleEntry {
            id: id.to_string(),
            agent_id: "agent-1".to_string(),
            markdown_path: format!("/tmp/memory/{}.md", id),
            tags_json: tags_json.map(|s| s.to_string()),
            created_at: created_at.to_string(),
            status: status.to_string(),
        }
    }

    fn old_timestamp() -> String {
        (Utc::now() - Duration::days(14)).to_rfc3339()
    }

    fn recent_timestamp() -> String {
        (Utc::now() - Duration::days(1)).to_rfc3339()
    }

    #[test]
    fn find_eligible_filters_by_age() {
        let compactor = MemoryCompactor::with_default_config();
        let entries = vec![
            make_entry("old", Some(r#"["test"]"#), &old_timestamp(), "active"),
            make_entry("new", Some(r#"["test"]"#), &recent_timestamp(), "active"),
        ];
        let groups = compactor.find_eligible(&entries, Utc::now());
        let total: usize = groups.iter().map(|(_, v)| v.len()).sum();
        assert_eq!(total, 1);
        assert_eq!(groups[0].1[0].id, "old");
    }

    #[test]
    fn find_eligible_filters_by_status() {
        let compactor = MemoryCompactor::with_default_config();
        let entries = vec![
            make_entry(
                "active-old",
                Some(r#"["test"]"#),
                &old_timestamp(),
                "active",
            ),
            make_entry(
                "archived-old",
                Some(r#"["test"]"#),
                &old_timestamp(),
                "archived",
            ),
        ];
        let groups = compactor.find_eligible(&entries, Utc::now());
        let total: usize = groups.iter().map(|(_, v)| v.len()).sum();
        assert_eq!(total, 1);
        assert_eq!(groups[0].1[0].id, "active-old");
    }

    #[test]
    fn find_eligible_groups_by_tag() {
        let compactor = MemoryCompactor::with_default_config();
        let entries = vec![
            make_entry("e1", Some(r#"["alpha"]"#), &old_timestamp(), "active"),
            make_entry("e2", Some(r#"["beta"]"#), &old_timestamp(), "active"),
            make_entry("e3", Some(r#"["alpha"]"#), &old_timestamp(), "active"),
        ];
        let groups = compactor.find_eligible(&entries, Utc::now());
        assert_eq!(groups.len(), 2);
        let mut tag_counts: std::collections::HashMap<String, usize> =
            std::collections::HashMap::new();
        for (tag, entries) in &groups {
            tag_counts.insert(tag.clone(), entries.len());
        }
        assert_eq!(tag_counts.get("alpha"), Some(&2));
        assert_eq!(tag_counts.get("beta"), Some(&1));
    }

    #[test]
    fn find_eligible_respects_batch_size() {
        let config = CompactionConfig {
            age_threshold_days: 7,
            max_batch_size: 2,
        };
        let compactor = MemoryCompactor::new(config);
        let entries: Vec<EligibleEntry> = (0..5)
            .map(|i| {
                make_entry(
                    &format!("e{}", i),
                    Some(r#"["same"]"#),
                    &old_timestamp(),
                    "active",
                )
            })
            .collect();
        let groups = compactor.find_eligible(&entries, Utc::now());
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].1.len(), 2);
    }

    #[test]
    fn build_summarization_prompt_formats_correctly() {
        let compactor = MemoryCompactor::with_default_config();
        let contents = vec![
            ("file1.md".to_string(), "Content one".to_string()),
            ("file2.md".to_string(), "Content two".to_string()),
        ];
        let prompt = compactor.build_summarization_prompt(&contents);
        assert!(prompt.contains("--- Entry: file1.md ---"));
        assert!(prompt.contains("Content one"));
        assert!(prompt.contains("--- Entry: file2.md ---"));
        assert!(prompt.contains("Content two"));
        assert!(prompt.contains("Provide a consolidated summary:"));
    }

    #[tokio::test]
    async fn compact_group_end_to_end() {
        let tmp = TempDir::new().unwrap();
        let memory_dir = tmp.path().join("memory");
        let archive_dir = tmp.path().join("archive");
        let source_dir = tmp.path().join("sources");
        std::fs::create_dir_all(&source_dir).unwrap();

        // Create source files
        let file1 = source_dir.join("note1.md");
        let file2 = source_dir.join("note2.md");
        std::fs::write(
            &file1,
            "---\ntimestamp: 2025-01-01T00:00:00Z\n---\n\nFirst note content\n",
        )
        .unwrap();
        std::fs::write(
            &file2,
            "---\ntimestamp: 2025-01-02T00:00:00Z\n---\n\nSecond note content\n",
        )
        .unwrap();

        let entries = vec![
            EligibleEntry {
                id: "e1".into(),
                agent_id: "agent-1".into(),
                markdown_path: file1.to_string_lossy().to_string(),
                tags_json: Some(r#"["project"]"#.into()),
                created_at: old_timestamp(),
                status: "active".into(),
            },
            EligibleEntry {
                id: "e2".into(),
                agent_id: "agent-1".into(),
                markdown_path: file2.to_string_lossy().to_string(),
                tags_json: Some(r#"["project"]"#.into()),
                created_at: old_timestamp(),
                status: "active".into(),
            },
        ];

        let compactor = MemoryCompactor::with_default_config();
        let result = compactor
            .compact_group(&entries, "project", &memory_dir, &archive_dir, None)
            .await
            .unwrap();

        assert_eq!(result.group_tag, "project");
        assert_eq!(result.entries_compacted, 2);
        assert_eq!(result.archived_count, 2);

        // Verify summary file was written
        assert!(std::path::Path::new(&result.summary_path).exists());
        let summary_content = std::fs::read_to_string(&result.summary_path).unwrap();
        assert!(summary_content.contains("compacted"));
        assert!(summary_content.contains("source_count: 2"));

        // Verify originals were archived
        assert!(!file1.exists());
        assert!(!file2.exists());
        assert!(archive_dir.join("note1.md").exists());
        assert!(archive_dir.join("note2.md").exists());
    }

    #[tokio::test]
    async fn compact_group_empty_returns_error() {
        let tmp = TempDir::new().unwrap();
        let memory_dir = tmp.path().join("memory");
        let archive_dir = tmp.path().join("archive");

        let compactor = MemoryCompactor::with_default_config();
        let result = compactor
            .compact_group(&[], "test", &memory_dir, &archive_dir, None)
            .await;

        assert!(matches!(result, Err(CompactionError::NoEligibleEntries)));
    }

    #[test]
    fn extract_primary_tag_with_tags() {
        let tags = Some(r#"["alpha","beta"]"#.to_string());
        let tag = MemoryCompactor::extract_primary_tag(&tags);
        assert_eq!(tag, "alpha");
    }

    #[test]
    fn extract_primary_tag_without_tags() {
        let tag = MemoryCompactor::extract_primary_tag(&None);
        assert_eq!(tag, "untagged");
    }
}
