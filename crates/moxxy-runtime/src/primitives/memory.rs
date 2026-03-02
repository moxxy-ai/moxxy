use async_trait::async_trait;
use moxxy_core::MemoryJournal;
use std::path::PathBuf;

use crate::registry::{Primitive, PrimitiveError};

pub struct MemoryAppendPrimitive {
    journal: MemoryJournal,
}

impl MemoryAppendPrimitive {
    pub fn new(journal: MemoryJournal) -> Self {
        Self { journal }
    }
}

#[async_trait]
impl Primitive for MemoryAppendPrimitive {
    fn name(&self) -> &str {
        "memory.append"
    }

    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        let content = params["content"]
            .as_str()
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'content' parameter".into()))?;

        let tags: Vec<String> = params["tags"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default();

        let tag_refs: Vec<&str> = tags.iter().map(|s| s.as_str()).collect();

        let record = self
            .journal
            .append(content, &tag_refs)
            .map_err(|e| PrimitiveError::ExecutionFailed(e.to_string()))?;

        Ok(serde_json::json!({
            "path": record.path,
            "timestamp": record.timestamp,
        }))
    }
}

pub struct MemorySearchPrimitive {
    base_dir: PathBuf,
}

impl MemorySearchPrimitive {
    pub fn new(base_dir: PathBuf) -> Self {
        Self { base_dir }
    }
}

#[async_trait]
impl Primitive for MemorySearchPrimitive {
    fn name(&self) -> &str {
        "memory.search"
    }

    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        let query = params["query"]
            .as_str()
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'query' parameter".into()))?;

        let query_lower = query.to_lowercase();
        let mut results = Vec::new();

        if self.base_dir.exists() {
            let entries = std::fs::read_dir(&self.base_dir)
                .map_err(|e| PrimitiveError::ExecutionFailed(e.to_string()))?;

            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().is_some_and(|ext| ext == "md")
                    && let Ok(content) = std::fs::read_to_string(&path)
                    && content.to_lowercase().contains(&query_lower)
                {
                    results.push(serde_json::json!({
                        "path": path.to_string_lossy(),
                        "snippet": content.chars().take(200).collect::<String>(),
                    }));
                }
            }
        }

        Ok(serde_json::json!({ "results": results }))
    }
}

pub struct MemorySummarizePrimitive {
    base_dir: PathBuf,
}

impl MemorySummarizePrimitive {
    pub fn new(base_dir: PathBuf) -> Self {
        Self { base_dir }
    }
}

#[async_trait]
impl Primitive for MemorySummarizePrimitive {
    fn name(&self) -> &str {
        "memory.summarize"
    }

    async fn invoke(
        &self,
        _params: serde_json::Value,
    ) -> Result<serde_json::Value, PrimitiveError> {
        let mut count: u64 = 0;
        let mut snippets = Vec::new();

        if self.base_dir.exists() {
            let entries = std::fs::read_dir(&self.base_dir)
                .map_err(|e| PrimitiveError::ExecutionFailed(e.to_string()))?;

            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().is_some_and(|ext| ext == "md") {
                    count += 1;
                    if let Ok(content) = std::fs::read_to_string(&path) {
                        // Extract first non-frontmatter line as snippet
                        let mut in_frontmatter = false;
                        for line in content.lines() {
                            if line.trim() == "---" {
                                in_frontmatter = !in_frontmatter;
                                continue;
                            }
                            if !in_frontmatter && !line.trim().is_empty() {
                                snippets.push(line.trim().to_string());
                                break;
                            }
                        }
                    }
                }
            }
        }

        let summary = if snippets.is_empty() {
            "No memory entries found.".to_string()
        } else {
            snippets.join("; ")
        };

        Ok(serde_json::json!({
            "summary": summary,
            "count": count,
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[tokio::test]
    async fn memory_append_writes_journal_entry() {
        let tmp = TempDir::new().unwrap();
        let journal = MemoryJournal::new(tmp.path().to_path_buf());
        let prim = MemoryAppendPrimitive::new(journal);
        let result = prim
            .invoke(serde_json::json!({
                "content": "Remember this",
                "tags": ["important"]
            }))
            .await
            .unwrap();
        assert!(result["path"].as_str().is_some());
    }

    #[tokio::test]
    async fn memory_search_returns_matching_records() {
        let tmp = TempDir::new().unwrap();
        let journal = MemoryJournal::new(tmp.path().to_path_buf());
        journal.append("Rust is great", &["rust"]).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(2));
        journal.append("Python is also great", &["python"]).unwrap();

        let prim = MemorySearchPrimitive::new(tmp.path().to_path_buf());
        let result = prim
            .invoke(serde_json::json!({"query": "great"}))
            .await
            .unwrap();
        let results = result["results"].as_array().unwrap();
        assert!(!results.is_empty());
    }

    #[tokio::test]
    async fn memory_summarize_produces_summary() {
        let tmp = TempDir::new().unwrap();
        let journal = MemoryJournal::new(tmp.path().to_path_buf());
        journal.append("Entry one about testing", &[]).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(2));
        journal.append("Entry two about coding", &[]).unwrap();

        let prim = MemorySummarizePrimitive::new(tmp.path().to_path_buf());
        let result = prim.invoke(serde_json::json!({})).await.unwrap();
        assert!(result["summary"].as_str().is_some());
        assert!(result["count"].as_u64().unwrap() >= 2);
    }
}
