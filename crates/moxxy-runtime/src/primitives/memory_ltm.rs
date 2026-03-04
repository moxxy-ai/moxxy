use async_trait::async_trait;
use moxxy_core::{EmbeddingService, embedding_to_bytes};
use moxxy_storage::Database;
use std::sync::{Arc, Mutex};

use crate::registry::{Primitive, PrimitiveError};

pub struct MemoryStorePrimitive {
    db: Arc<Mutex<Database>>,
    agent_id: String,
    embedding_svc: Arc<dyn EmbeddingService>,
}

impl MemoryStorePrimitive {
    pub fn new(
        db: Arc<Mutex<Database>>,
        agent_id: String,
        embedding_svc: Arc<dyn EmbeddingService>,
    ) -> Self {
        Self {
            db,
            agent_id,
            embedding_svc,
        }
    }
}

#[async_trait]
impl Primitive for MemoryStorePrimitive {
    fn name(&self) -> &str {
        "memory.store"
    }

    fn description(&self) -> &str {
        "Store content in long-term memory (LTM) with vector embedding for semantic search."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "content": {"type": "string", "description": "The content to store in long-term memory"},
                "tags": {"type": "array", "items": {"type": "string"}, "description": "Optional tags for categorization"}
            },
            "required": ["content"]
        })
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

        tracing::info!(
            content_len = content.len(),
            tags_count = tags.len(),
            "Storing in LTM"
        );

        // Compute embedding
        let embedding = self
            .embedding_svc
            .embed(content)
            .await
            .map_err(|e| PrimitiveError::ExecutionFailed(format!("embedding failed: {}", e)))?;
        let embedding_bytes = embedding_to_bytes(&embedding);

        let now = chrono::Utc::now().to_rfc3339();
        let id = uuid::Uuid::now_v7().to_string();

        let tags_json = if tags.is_empty() {
            None
        } else {
            Some(serde_json::to_string(&tags).unwrap_or_default())
        };

        let row = moxxy_storage::MemoryIndexRow {
            id: id.clone(),
            agent_id: self.agent_id.clone(),
            markdown_path: String::new(),
            tags_json,
            chunk_hash: None,
            embedding_id: Some(id.clone()),
            status: "active".into(),
            created_at: now.clone(),
            updated_at: now,
            content: Some(content.to_string()),
        };

        let db = self
            .db
            .lock()
            .map_err(|e| PrimitiveError::ExecutionFailed(e.to_string()))?;
        db.memory()
            .insert_with_embedding(&row, &embedding_bytes)
            .map_err(|e| PrimitiveError::ExecutionFailed(e.to_string()))?;

        Ok(serde_json::json!({
            "id": id,
            "status": "stored"
        }))
    }
}

pub struct MemoryRecallPrimitive {
    db: Arc<Mutex<Database>>,
    agent_id: String,
    embedding_svc: Arc<dyn EmbeddingService>,
}

impl MemoryRecallPrimitive {
    pub fn new(
        db: Arc<Mutex<Database>>,
        agent_id: String,
        embedding_svc: Arc<dyn EmbeddingService>,
    ) -> Self {
        Self {
            db,
            agent_id,
            embedding_svc,
        }
    }
}

#[async_trait]
impl Primitive for MemoryRecallPrimitive {
    fn name(&self) -> &str {
        "memory.recall"
    }

    fn description(&self) -> &str {
        "Recall content from long-term memory (LTM) via semantic search."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Search query for semantic recall"},
                "limit": {"type": "integer", "description": "Maximum number of results to return (default: 5)", "default": 5}
            },
            "required": ["query"]
        })
    }

    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        let query = params["query"]
            .as_str()
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'query' parameter".into()))?;

        let limit = params.get("limit").and_then(|v| v.as_u64()).unwrap_or(5) as usize;

        tracing::debug!(query, limit, "Recalling from LTM");

        // Embed the query
        let embedding = self
            .embedding_svc
            .embed(query)
            .await
            .map_err(|e| PrimitiveError::ExecutionFailed(format!("embedding failed: {}", e)))?;
        let embedding_bytes = embedding_to_bytes(&embedding);

        let db = self
            .db
            .lock()
            .map_err(|e| PrimitiveError::ExecutionFailed(e.to_string()))?;
        let results = db
            .memory()
            .search_similar(&self.agent_id, &embedding_bytes, limit)
            .map_err(|e| PrimitiveError::ExecutionFailed(e.to_string()))?;

        let entries: Vec<serde_json::Value> = results
            .into_iter()
            .map(|(row, distance)| {
                let tags: Vec<String> = row
                    .tags_json
                    .as_deref()
                    .and_then(|j| serde_json::from_str(j).ok())
                    .unwrap_or_default();
                serde_json::json!({
                    "id": row.id,
                    "content": row.content.unwrap_or_default(),
                    "tags": tags,
                    "score": 1.0 - distance,
                    "created_at": row.created_at,
                })
            })
            .collect();

        Ok(serde_json::json!({ "results": entries }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use moxxy_core::MockEmbeddingService;
    use moxxy_storage::AgentRow;
    use moxxy_test_utils::TestDb;

    fn setup() -> (Arc<Mutex<Database>>, String, Arc<MockEmbeddingService>) {
        let test_db = TestDb::new();
        let db = Database::new(test_db.into_conn());
        let db = Arc::new(Mutex::new(db));

        let agent_id = uuid::Uuid::now_v7().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        {
            let db_lock = db.lock().unwrap();
            db_lock
                .agents()
                .insert(&AgentRow {
                    id: agent_id.clone(),
                    parent_agent_id: None,
                    name: Some("test-ltm-agent".into()),
                    status: "idle".into(),
                    depth: 0,
                    spawned_total: 0,
                    workspace_root: "/tmp/test".into(),
                    created_at: now.clone(),
                    updated_at: now,
                })
                .unwrap();
        }

        let embedding_svc = Arc::new(MockEmbeddingService::new());
        (db, agent_id, embedding_svc)
    }

    #[tokio::test]
    async fn store_and_recall() {
        let (db, agent_id, embedding_svc) = setup();

        let store = MemoryStorePrimitive::new(db.clone(), agent_id.clone(), embedding_svc.clone());
        let result = store
            .invoke(serde_json::json!({
                "content": "Rust is a systems programming language",
                "tags": ["rust", "programming"]
            }))
            .await
            .unwrap();
        assert_eq!(result["status"], "stored");
        assert!(result["id"].as_str().is_some());

        let recall = MemoryRecallPrimitive::new(db, agent_id, embedding_svc);
        let result = recall
            .invoke(serde_json::json!({"query": "Rust is a systems programming language"}))
            .await
            .unwrap();
        let results = result["results"].as_array().unwrap();
        assert!(!results.is_empty());
        assert!(results[0]["content"].as_str().unwrap().contains("Rust"));
    }

    #[tokio::test]
    async fn store_without_tags() {
        let (db, agent_id, embedding_svc) = setup();

        let store = MemoryStorePrimitive::new(db, agent_id, embedding_svc);
        let result = store
            .invoke(serde_json::json!({"content": "Just a plain note"}))
            .await
            .unwrap();
        assert_eq!(result["status"], "stored");
    }

    #[tokio::test]
    async fn recall_empty_returns_empty() {
        let (db, agent_id, embedding_svc) = setup();

        let recall = MemoryRecallPrimitive::new(db, agent_id, embedding_svc);
        let result = recall
            .invoke(serde_json::json!({"query": "anything"}))
            .await
            .unwrap();
        let results = result["results"].as_array().unwrap();
        assert!(results.is_empty());
    }

    #[tokio::test]
    async fn recall_respects_limit() {
        let (db, agent_id, embedding_svc) = setup();

        let store = MemoryStorePrimitive::new(db.clone(), agent_id.clone(), embedding_svc.clone());
        for i in 0..5 {
            store
                .invoke(serde_json::json!({"content": format!("note {}", i)}))
                .await
                .unwrap();
        }

        let recall = MemoryRecallPrimitive::new(db, agent_id, embedding_svc);
        let result = recall
            .invoke(serde_json::json!({"query": "note", "limit": 2}))
            .await
            .unwrap();
        let results = result["results"].as_array().unwrap();
        assert!(results.len() <= 2);
    }
}
