use async_trait::async_trait;
use moxxy_core::{LoadedWebhook, WebhookDoc, WebhookStore};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex as StdMutex, RwLock};
use tokio::sync::oneshot;

use crate::context::PrimitiveContext;
use crate::registry::{Primitive, PrimitiveError};

/// Shared map of pending webhook listen channels, keyed by webhook token.
pub type WebhookListenChannels = Arc<StdMutex<HashMap<String, oneshot::Sender<serde_json::Value>>>>;

/// Creates a new empty WebhookListenChannels map.
pub fn new_webhook_listen_channels() -> WebhookListenChannels {
    Arc::new(StdMutex::new(HashMap::new()))
}

pub struct WebhookRegisterPrimitive {
    ctx: PrimitiveContext,
    agent_name: String,
    moxxy_home: PathBuf,
    base_url: String,
    webhook_index: Arc<RwLock<HashMap<String, LoadedWebhook>>>,
}

impl WebhookRegisterPrimitive {
    pub fn new(
        ctx: PrimitiveContext,
        agent_name: String,
        moxxy_home: PathBuf,
        base_url: String,
        webhook_index: Arc<RwLock<HashMap<String, LoadedWebhook>>>,
    ) -> Self {
        Self {
            ctx,
            agent_name,
            moxxy_home,
            base_url,
            webhook_index,
        }
    }
}

#[async_trait]
impl Primitive for WebhookRegisterPrimitive {
    fn name(&self) -> &str {
        "webhook.register"
    }

    fn description(&self) -> &str {
        "Register an inbound webhook endpoint. External services POST events to the returned URL. \
         IMPORTANT: Always provide a 'body' with detailed markdown instructions describing exactly \
         what the agent should do when this webhook fires. The body is the agent's task - write it \
         like a prompt: explain what data to extract, what actions to take, and what tools to use. \
         Use {{path.to.value}} template placeholders (e.g. {{body.commits}}, {{body.action}}, \
         {{event_type}}) that will be rendered with the incoming payload at delivery time. \
         Without a body, the agent receives only a raw dump of the payload with no guidance."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "label": {"type": "string", "description": "Human-readable label for this webhook"},
                "secret": {"type": "string", "description": "Optional HMAC-SHA256 secret. If omitted, the webhook uses token-only auth (no signature verification)."},
                "event_filter": {"type": "string", "description": "Optional comma-separated event types to accept (e.g. 'push,pull_request')"},
                "body": {
                    "type": "string",
                    "description": "RECOMMENDED. Markdown instructions that become the agent's task when this webhook fires. \
                        Write detailed step-by-step instructions: what to extract from the payload, what actions to take, \
                        which primitives to use. Use {{path.to.value}} template placeholders rendered against the incoming \
                        delivery. Available template variables: body (parsed JSON payload, e.g. {{body.commits}}, \
                        {{body.pull_request.title}}), event_type (e.g. 'push'), headers (HTTP headers), source_ip, \
                        label (this webhook's label). Example: 'Parse commits from {{body.commits}}, check for issue \
                        references, and use channel.notify to post updates for each referenced issue.'"
                }
            },
            "required": ["label"]
        })
    }

    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        let label = params["label"]
            .as_str()
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'label' parameter".into()))?;

        let secret = params["secret"].as_str().map(|s| s.to_string());
        let event_filter = params["event_filter"].as_str().map(|s| s.to_string());
        let body = params["body"].as_str().unwrap_or("").to_string();

        tracing::info!(agent_name = %self.agent_name, label, has_body = !body.is_empty(), "Registering inbound webhook");

        let token = uuid::Uuid::now_v7().to_string();

        // Store the HMAC secret in the vault only if a secret was provided
        let secret_ref = if let Some(ref secret_val) = secret {
            let slug_base = label
                .to_lowercase()
                .chars()
                .map(|c| {
                    if c.is_alphanumeric() || c == '-' {
                        c
                    } else {
                        '-'
                    }
                })
                .collect::<String>();
            let key_name = format!("webhook_secret_{}", slug_base);
            let backend_key = format!("webhook_secret_{}", token);
            self.ctx.set_secret(&backend_key, secret_val)?;
            let ref_id = self
                .ctx
                .create_secret_ref(&key_name, &backend_key, Some("webhook"))?;
            self.ctx.grant_access(self.ctx.agent_id(), &ref_id)?;
            Some(key_name)
        } else {
            None
        };

        let doc = WebhookDoc {
            label: label.to_string(),
            token: token.clone(),
            event_filter,
            enabled: true,
            secret_ref: secret_ref.clone(),
            body: body.clone(),
        };

        // Write to filesystem
        WebhookStore::create(&self.moxxy_home, &self.agent_name, &doc)
            .map_err(|e| PrimitiveError::ExecutionFailed(format!("Failed to save webhook: {e}")))?;

        // Add to in-memory index
        {
            let loaded = LoadedWebhook {
                doc: doc.clone(),
                agent_name: self.agent_name.clone(),
                path: self
                    .moxxy_home
                    .join("agents")
                    .join(&self.agent_name)
                    .join("webhooks")
                    .join(doc.slug())
                    .join("WEBHOOK.md"),
            };
            let mut index = self
                .webhook_index
                .write()
                .map_err(|e| PrimitiveError::ExecutionFailed(format!("webhook index lock: {e}")))?;
            index.insert(token.clone(), loaded);
        }

        let url = format!("{}/v1/hooks/{}", self.base_url.trim_end_matches('/'), token);

        let mut response = serde_json::json!({
            "slug": doc.slug(),
            "label": label,
            "url": url,
            "token": token,
            "enabled": true,
            "status": "registered",
            "has_body": !body.is_empty(),
        });
        if let Some(ref s) = secret {
            response["secret"] = serde_json::Value::String(s.clone());
        }
        Ok(response)
    }
}

pub struct WebhookListPrimitive {
    agent_name: String,
    moxxy_home: PathBuf,
    base_url: String,
}

impl WebhookListPrimitive {
    pub fn new(agent_name: String, moxxy_home: PathBuf, base_url: String) -> Self {
        Self {
            agent_name,
            moxxy_home,
            base_url,
        }
    }
}

#[async_trait]
impl Primitive for WebhookListPrimitive {
    fn name(&self) -> &str {
        "webhook.list"
    }

    fn description(&self) -> &str {
        "List all inbound webhooks registered for the current agent."
    }

    fn is_concurrent_safe(&self) -> bool {
        true
    }

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {},
            "required": []
        })
    }

    async fn invoke(
        &self,
        _params: serde_json::Value,
    ) -> Result<serde_json::Value, PrimitiveError> {
        tracing::debug!(agent_name = %self.agent_name, "Listing inbound webhooks");

        let webhooks = moxxy_core::WebhookLoader::load_agent(&self.moxxy_home, &self.agent_name);

        let base = self.base_url.trim_end_matches('/');
        let result: Vec<serde_json::Value> = webhooks
            .iter()
            .map(|w| {
                serde_json::json!({
                    "slug": w.doc.slug(),
                    "label": w.doc.label,
                    "url": format!("{}/v1/hooks/{}", base, w.doc.token),
                    "event_filter": w.doc.event_filter,
                    "enabled": w.doc.enabled,
                    "has_body": !w.doc.body.is_empty(),
                })
            })
            .collect();

        Ok(serde_json::json!({ "webhooks": result }))
    }
}

pub struct WebhookDeletePrimitive {
    ctx: PrimitiveContext,
    agent_name: String,
    moxxy_home: PathBuf,
    webhook_index: Arc<RwLock<HashMap<String, LoadedWebhook>>>,
}

impl WebhookDeletePrimitive {
    pub fn new(
        ctx: PrimitiveContext,
        agent_name: String,
        moxxy_home: PathBuf,
        webhook_index: Arc<RwLock<HashMap<String, LoadedWebhook>>>,
    ) -> Self {
        Self {
            ctx,
            agent_name,
            moxxy_home,
            webhook_index,
        }
    }
}

#[async_trait]
impl Primitive for WebhookDeletePrimitive {
    fn name(&self) -> &str {
        "webhook.delete"
    }

    fn description(&self) -> &str {
        "Delete an inbound webhook by slug. Cleans up the associated HMAC secret."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "slug": {"type": "string", "description": "Slug of the webhook to delete"}
            },
            "required": ["slug"]
        })
    }

    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        let slug = params["slug"]
            .as_str()
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'slug' parameter".into()))?;

        tracing::info!(agent_name = %self.agent_name, slug, "Deleting inbound webhook");

        // Load doc to get token and secret_ref
        let doc = WebhookStore::load(&self.moxxy_home, &self.agent_name, slug).map_err(|e| {
            PrimitiveError::InvalidParams(format!("Webhook '{}' not found: {}", slug, e))
        })?;

        // Clean up vault secret if configured
        if let Some(ref key_name) = doc.secret_ref
            && let Ok(Some(secret_ref)) = self.ctx.find_secret_ref(key_name)
        {
            let _ = self.ctx.delete_secret(&secret_ref.backend_key);
            let _ = self.ctx.delete_secret_ref(&secret_ref.id);
        }

        // Delete from filesystem
        WebhookStore::delete(&self.moxxy_home, &self.agent_name, slug).map_err(|e| {
            PrimitiveError::ExecutionFailed(format!("Failed to delete webhook: {e}"))
        })?;

        // Remove from in-memory index
        {
            let mut index = self
                .webhook_index
                .write()
                .map_err(|e| PrimitiveError::ExecutionFailed(format!("webhook index lock: {e}")))?;
            index.remove(&doc.token);
        }

        Ok(serde_json::json!({
            "status": "deleted",
            "slug": slug,
        }))
    }
}

pub struct WebhookUpdatePrimitive {
    agent_name: String,
    moxxy_home: PathBuf,
    webhook_index: Arc<RwLock<HashMap<String, LoadedWebhook>>>,
}

impl WebhookUpdatePrimitive {
    pub fn new(
        agent_name: String,
        moxxy_home: PathBuf,
        webhook_index: Arc<RwLock<HashMap<String, LoadedWebhook>>>,
    ) -> Self {
        Self {
            agent_name,
            moxxy_home,
            webhook_index,
        }
    }
}

#[async_trait]
impl Primitive for WebhookUpdatePrimitive {
    fn name(&self) -> &str {
        "webhook.update"
    }

    fn description(&self) -> &str {
        "Update a webhook's label, event_filter, enabled status, or body instructions. \
         Use 'body' to change what the agent does when this webhook fires - write detailed \
         step-by-step instructions with {{template}} placeholders."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "slug": {"type": "string", "description": "Slug of the webhook to update"},
                "label": {"type": "string", "description": "New label (also changes the slug/directory name)"},
                "event_filter": {"type": "string", "description": "New comma-separated event filter (empty string to clear)"},
                "enabled": {"type": "boolean", "description": "Enable or disable the webhook"},
                "body": {
                    "type": "string",
                    "description": "New markdown instructions for the agent when this webhook fires. \
                        Write detailed steps: what data to extract, what actions to take, which primitives to use. \
                        Use {{path.to.value}} template placeholders (e.g. {{body.commits}}, {{event_type}})."
                }
            },
            "required": ["slug"]
        })
    }

    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        let slug = params["slug"]
            .as_str()
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'slug' parameter".into()))?;

        // Load current doc to get old token (for index key update)
        let old_doc =
            WebhookStore::load(&self.moxxy_home, &self.agent_name, slug).map_err(|e| {
                PrimitiveError::InvalidParams(format!("Webhook '{}' not found: {}", slug, e))
            })?;
        let old_token = old_doc.token.clone();

        let new_label = params["label"].as_str().map(|s| s.to_string());
        let new_event_filter = params.get("event_filter");
        let new_enabled = params["enabled"].as_bool();
        let new_body = params.get("body");

        tracing::info!(
            agent_name = %self.agent_name, slug,
            "Updating webhook"
        );

        let updated = WebhookStore::update(&self.moxxy_home, &self.agent_name, slug, |doc| {
            if let Some(ref label) = new_label {
                doc.label = label.clone();
            }
            if let Some(ef) = new_event_filter {
                if ef.is_null() || ef.as_str() == Some("") {
                    doc.event_filter = None;
                } else if let Some(s) = ef.as_str() {
                    doc.event_filter = Some(s.to_string());
                }
            }
            if let Some(enabled) = new_enabled {
                doc.enabled = enabled;
            }
            if let Some(b) = new_body
                && let Some(s) = b.as_str()
            {
                doc.body = s.to_string();
            }
        })
        .map_err(|e| PrimitiveError::ExecutionFailed(format!("Failed to update webhook: {e}")))?;

        // Update the in-memory index
        {
            let mut index = self
                .webhook_index
                .write()
                .map_err(|e| PrimitiveError::ExecutionFailed(format!("webhook index lock: {e}")))?;
            if let Some(entry) = index.get_mut(&old_token) {
                entry.doc = updated.clone();
                entry.path = self
                    .moxxy_home
                    .join("agents")
                    .join(&self.agent_name)
                    .join("webhooks")
                    .join(updated.slug())
                    .join("WEBHOOK.md");
            }
        }

        Ok(serde_json::json!({
            "status": "updated",
            "slug": updated.slug(),
            "label": updated.label,
            "event_filter": updated.event_filter,
            "enabled": updated.enabled,
            "has_body": !updated.body.is_empty(),
        }))
    }
}

pub struct WebhookRotatePrimitive {
    ctx: PrimitiveContext,
    agent_name: String,
    moxxy_home: PathBuf,
    base_url: String,
    webhook_index: Arc<RwLock<HashMap<String, LoadedWebhook>>>,
}

impl WebhookRotatePrimitive {
    pub fn new(
        ctx: PrimitiveContext,
        agent_name: String,
        moxxy_home: PathBuf,
        base_url: String,
        webhook_index: Arc<RwLock<HashMap<String, LoadedWebhook>>>,
    ) -> Self {
        Self {
            ctx,
            agent_name,
            moxxy_home,
            base_url,
            webhook_index,
        }
    }
}

#[async_trait]
impl Primitive for WebhookRotatePrimitive {
    fn name(&self) -> &str {
        "webhook.rotate"
    }

    fn description(&self) -> &str {
        "Rotate a webhook's token and/or HMAC secret. Returns the new URL and (if rotated) the new secret."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "slug": {"type": "string", "description": "Slug of the webhook to rotate"},
                "rotate_token": {"type": "boolean", "description": "Generate a new webhook token (changes the URL). Default: true."},
                "new_secret": {"type": "string", "description": "New HMAC secret. If omitted with rotate_secret=true, the existing secret is removed (downgrades to token-only auth)."},
                "rotate_secret": {"type": "boolean", "description": "Whether to rotate/change the HMAC secret. Default: false."}
            },
            "required": ["slug"]
        })
    }

    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        let slug = params["slug"]
            .as_str()
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'slug' parameter".into()))?;

        let rotate_token = params["rotate_token"].as_bool().unwrap_or(true);
        let rotate_secret = params["rotate_secret"].as_bool().unwrap_or(false);
        let new_secret_val = params["new_secret"].as_str().map(|s| s.to_string());

        tracing::info!(
            agent_name = %self.agent_name, slug,
            rotate_token, rotate_secret,
            "Rotating webhook credentials"
        );

        // Load current doc
        let old_doc =
            WebhookStore::load(&self.moxxy_home, &self.agent_name, slug).map_err(|e| {
                PrimitiveError::InvalidParams(format!("Webhook '{}' not found: {}", slug, e))
            })?;
        let old_token = old_doc.token.clone();

        let new_token = if rotate_token {
            uuid::Uuid::now_v7().to_string()
        } else {
            old_doc.token.clone()
        };

        // Handle secret rotation
        let new_secret_ref = if rotate_secret {
            // Clean up old vault secret
            if let Some(ref old_key_name) = old_doc.secret_ref
                && let Ok(Some(secret_ref)) = self.ctx.find_secret_ref(old_key_name)
            {
                let _ = self.ctx.delete_secret(&secret_ref.backend_key);
                let _ = self.ctx.delete_secret_ref(&secret_ref.id);
            }

            // Store new secret if provided
            if let Some(ref secret_val) = new_secret_val {
                let key_name = format!("webhook_secret_{}", slug);
                let backend_key = format!("webhook_secret_{}", new_token);
                self.ctx.set_secret(&backend_key, secret_val)?;
                let ref_id =
                    self.ctx
                        .create_secret_ref(&key_name, &backend_key, Some("webhook"))?;
                self.ctx.grant_access(self.ctx.agent_id(), &ref_id)?;
                Some(key_name)
            } else {
                None // downgrade to token-only
            }
        } else {
            old_doc.secret_ref.clone() // keep existing
        };

        // Update the WEBHOOK.md file
        let updated = WebhookStore::update(&self.moxxy_home, &self.agent_name, slug, |doc| {
            doc.token = new_token.clone();
            doc.secret_ref = new_secret_ref.clone();
        })
        .map_err(|e| PrimitiveError::ExecutionFailed(format!("Failed to update webhook: {e}")))?;

        // Update in-memory index: remove old token key, insert new
        {
            let mut index = self
                .webhook_index
                .write()
                .map_err(|e| PrimitiveError::ExecutionFailed(format!("webhook index lock: {e}")))?;
            index.remove(&old_token);
            index.insert(
                new_token.clone(),
                LoadedWebhook {
                    doc: updated.clone(),
                    agent_name: self.agent_name.clone(),
                    path: self
                        .moxxy_home
                        .join("agents")
                        .join(&self.agent_name)
                        .join("webhooks")
                        .join(updated.slug())
                        .join("WEBHOOK.md"),
                },
            );
        }

        let url = format!(
            "{}/v1/hooks/{}",
            self.base_url.trim_end_matches('/'),
            new_token
        );

        let mut response = serde_json::json!({
            "status": "rotated",
            "slug": updated.slug(),
            "url": url,
            "token_rotated": rotate_token,
            "secret_rotated": rotate_secret,
            "has_secret": updated.secret_ref.is_some(),
        });
        if let Some(ref s) = new_secret_val {
            response["new_secret"] = serde_json::Value::String(s.clone());
        }
        Ok(response)
    }
}

pub struct WebhookListenPrimitive {
    agent_name: String,
    moxxy_home: PathBuf,
    webhook_index: Arc<RwLock<HashMap<String, LoadedWebhook>>>,
    webhook_listen_channels: WebhookListenChannels,
}

impl WebhookListenPrimitive {
    pub fn new(
        agent_name: String,
        moxxy_home: PathBuf,
        webhook_index: Arc<RwLock<HashMap<String, LoadedWebhook>>>,
        webhook_listen_channels: WebhookListenChannels,
    ) -> Self {
        Self {
            agent_name,
            moxxy_home,
            webhook_index,
            webhook_listen_channels,
        }
    }

    fn cleanup_channel(&self, token: &str) {
        if let Ok(mut channels) = self.webhook_listen_channels.lock() {
            channels.remove(token);
        }
    }
}

#[async_trait]
impl Primitive for WebhookListenPrimitive {
    fn name(&self) -> &str {
        "webhook.listen"
    }

    fn description(&self) -> &str {
        "Wait for an inbound webhook delivery. Blocks the agent until a POST arrives or the timeout expires. \
         NOTE: For most use cases, prefer providing a 'body' with detailed task instructions on \
         webhook.register instead - that starts an autonomous agent run when the webhook fires. \
         Only use webhook.listen when you need to process the payload inline during an already \
         active run (e.g. waiting for a callback in a multi-step workflow)."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "slug": {"type": "string", "description": "Slug of the webhook to listen on"},
                "timeout_seconds": {
                    "type": "integer",
                    "description": "How long to wait for a delivery (default: 300, max: 600)"
                }
            },
            "required": ["slug"]
        })
    }

    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        let slug = params["slug"]
            .as_str()
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'slug' parameter".into()))?;

        let timeout_seconds = params
            .get("timeout_seconds")
            .and_then(|v| v.as_u64())
            .unwrap_or(300)
            .min(600);

        tracing::info!(
            agent_name = %self.agent_name, slug, timeout_seconds,
            "Agent listening for webhook delivery"
        );

        // Load webhook doc by slug to get the token
        let doc = WebhookStore::load(&self.moxxy_home, &self.agent_name, slug).map_err(|e| {
            PrimitiveError::NotFound(format!("Webhook '{}' not found: {}", slug, e))
        })?;

        // Verify ownership via webhook_index
        {
            let index = self
                .webhook_index
                .read()
                .map_err(|e| PrimitiveError::ExecutionFailed(format!("webhook index lock: {e}")))?;
            match index.get(&doc.token) {
                Some(loaded) if loaded.agent_name == self.agent_name => {}
                _ => {
                    return Err(PrimitiveError::AccessDenied(format!(
                        "webhook '{}' not owned by agent '{}'",
                        slug, self.agent_name
                    )));
                }
            }
        }

        // Create oneshot channel
        let (tx, rx) = oneshot::channel::<serde_json::Value>();

        // Insert sender keyed by token, checking for existing listener
        {
            let mut channels = self.webhook_listen_channels.lock().map_err(|_| {
                PrimitiveError::ExecutionFailed("webhook listen channels lock poisoned".into())
            })?;
            if channels.contains_key(&doc.token) {
                return Err(PrimitiveError::ExecutionFailed(format!(
                    "another listener is already waiting on webhook '{}'",
                    slug
                )));
            }
            channels.insert(doc.token.clone(), tx);
        }

        // Wait for delivery or timeout
        let timeout = std::time::Duration::from_secs(timeout_seconds);
        match tokio::time::timeout(timeout, rx).await {
            Ok(Ok(payload)) => {
                tracing::debug!(slug, "Webhook delivery received by listener");
                Ok(payload)
            }
            Ok(Err(_)) => {
                // Sender dropped without sending
                tracing::warn!(slug, "Webhook listen channel closed without delivery");
                self.cleanup_channel(&doc.token);
                Err(PrimitiveError::ExecutionFailed(
                    "webhook listen channel closed without delivery".into(),
                ))
            }
            Err(_) => {
                // Timeout
                tracing::warn!(slug, timeout_seconds, "Webhook listen timed out");
                self.cleanup_channel(&doc.token);
                Err(PrimitiveError::Timeout)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use moxxy_storage::Database;
    use moxxy_test_utils::TestDb;
    use moxxy_vault::InMemoryBackend;
    use std::sync::Mutex;

    fn setup() -> (
        PrimitiveContext,
        PathBuf,
        Arc<RwLock<HashMap<String, LoadedWebhook>>>,
    ) {
        let test_db = TestDb::new();
        let db = Database::new(test_db.into_conn());
        let now = chrono::Utc::now().to_rfc3339();

        let agent_id = uuid::Uuid::now_v7().to_string();
        db.agents()
            .insert(&moxxy_storage::AgentRow {
                id: agent_id.clone(),
                parent_agent_id: None,
                name: Some("test-agent".into()),
                status: "idle".into(),
                depth: 0,
                spawned_total: 0,
                workspace_root: "/tmp".into(),
                created_at: now.clone(),
                updated_at: now,
            })
            .unwrap();

        let db = Arc::new(Mutex::new(db));
        let backend = Arc::new(InMemoryBackend::new());
        let ctx = PrimitiveContext::new(db, agent_id, backend);
        let tmp = tempfile::tempdir().unwrap();
        let home = tmp.into_path();
        std::fs::create_dir_all(home.join("agents/test-agent/webhooks")).unwrap();
        let index = Arc::new(RwLock::new(HashMap::new()));
        (ctx, home, index)
    }

    #[tokio::test]
    async fn webhook_register_creates_doc_and_index() {
        let (ctx, home, index) = setup();
        let prim = WebhookRegisterPrimitive::new(
            ctx,
            "test-agent".into(),
            home.clone(),
            "https://moxxy.example.com".into(),
            index.clone(),
        );
        let result = prim
            .invoke(serde_json::json!({
                "label": "GitHub Events",
                "secret": "my-hmac-secret",
                "body": "Handle {{body.action}} event",
            }))
            .await
            .unwrap();

        assert_eq!(result["status"], "registered");
        assert_eq!(result["label"], "GitHub Events");
        assert!(result["url"].as_str().unwrap().contains("/v1/hooks/"));
        assert_eq!(result["has_body"], true);

        // Verify WEBHOOK.md file exists
        let slugs = WebhookStore::list(&home, "test-agent");
        assert_eq!(slugs.len(), 1);

        // Verify index updated
        let idx = index.read().unwrap();
        assert_eq!(idx.len(), 1);
    }

    #[tokio::test]
    async fn webhook_register_requires_label() {
        let (ctx, home, index) = setup();
        let prim = WebhookRegisterPrimitive::new(
            ctx,
            "test-agent".into(),
            home,
            "https://moxxy.example.com".into(),
            index,
        );
        let result = prim
            .invoke(serde_json::json!({
                "secret": "my-secret",
            }))
            .await;
        assert!(result.is_err());
        assert!(matches!(
            result.unwrap_err(),
            PrimitiveError::InvalidParams(_)
        ));
    }

    #[tokio::test]
    async fn webhook_register_without_secret_uses_token_only() {
        let (ctx, home, index) = setup();
        let prim = WebhookRegisterPrimitive::new(
            ctx,
            "test-agent".into(),
            home.clone(),
            "https://moxxy.example.com".into(),
            index,
        );
        let result = prim
            .invoke(serde_json::json!({
                "label": "No Secret",
            }))
            .await
            .unwrap();
        assert!(result["secret"].is_null());
        assert_eq!(result["status"], "registered");

        // Verify secret_ref is None in doc
        let doc = WebhookStore::load(&home, "test-agent", "no-secret").unwrap();
        assert!(doc.secret_ref.is_none());
    }

    #[tokio::test]
    async fn webhook_list_returns_agent_webhooks() {
        let (ctx, home, index) = setup();

        // Register two webhooks
        let register = WebhookRegisterPrimitive::new(
            ctx.clone(),
            "test-agent".into(),
            home.clone(),
            "https://moxxy.example.com".into(),
            index.clone(),
        );
        register
            .invoke(serde_json::json!({
                "label": "Hook A",
                "secret": "secret-a",
            }))
            .await
            .unwrap();
        let register2 = WebhookRegisterPrimitive::new(
            ctx,
            "test-agent".into(),
            home.clone(),
            "https://moxxy.example.com".into(),
            index,
        );
        register2
            .invoke(serde_json::json!({
                "label": "Hook B",
                "secret": "secret-b",
            }))
            .await
            .unwrap();

        let list = WebhookListPrimitive::new(
            "test-agent".into(),
            home,
            "https://moxxy.example.com".into(),
        );
        let result = list.invoke(serde_json::json!({})).await.unwrap();
        let webhooks = result["webhooks"].as_array().unwrap();
        assert_eq!(webhooks.len(), 2);
    }

    #[tokio::test]
    async fn webhook_delete_removes_webhook() {
        let (ctx, home, index) = setup();

        // Register a webhook
        let register = WebhookRegisterPrimitive::new(
            ctx.clone(),
            "test-agent".into(),
            home.clone(),
            "https://moxxy.example.com".into(),
            index.clone(),
        );
        let result = register
            .invoke(serde_json::json!({
                "label": "To Delete",
                "secret": "secret-del",
            }))
            .await
            .unwrap();
        let slug = result["slug"].as_str().unwrap().to_string();

        // Delete it
        let delete =
            WebhookDeletePrimitive::new(ctx, "test-agent".into(), home.clone(), index.clone());
        let del_result = delete
            .invoke(serde_json::json!({"slug": slug}))
            .await
            .unwrap();
        assert_eq!(del_result["status"], "deleted");

        // Verify gone
        assert!(WebhookStore::list(&home, "test-agent").is_empty());
        assert!(index.read().unwrap().is_empty());
    }

    #[tokio::test]
    async fn webhook_update_modifies_doc() {
        let (ctx, home, index) = setup();

        // Register
        let register = WebhookRegisterPrimitive::new(
            ctx,
            "test-agent".into(),
            home.clone(),
            "https://moxxy.example.com".into(),
            index.clone(),
        );
        register
            .invoke(serde_json::json!({"label": "Updatable"}))
            .await
            .unwrap();

        // Update
        let update = WebhookUpdatePrimitive::new("test-agent".into(), home.clone(), index.clone());
        let result = update
            .invoke(serde_json::json!({
                "slug": "updatable",
                "event_filter": "push,pull_request",
                "enabled": false,
            }))
            .await
            .unwrap();
        assert_eq!(result["status"], "updated");
        assert_eq!(result["event_filter"], "push,pull_request");
        assert_eq!(result["enabled"], false);

        // Verify persisted
        let doc = WebhookStore::load(&home, "test-agent", "updatable").unwrap();
        assert_eq!(doc.event_filter.as_deref(), Some("push,pull_request"));
        assert!(!doc.enabled);
    }

    #[tokio::test]
    async fn webhook_rotate_changes_token() {
        let (ctx, home, index) = setup();

        // Register
        let register = WebhookRegisterPrimitive::new(
            ctx.clone(),
            "test-agent".into(),
            home.clone(),
            "https://moxxy.example.com".into(),
            index.clone(),
        );
        let reg_result = register
            .invoke(serde_json::json!({"label": "Rotatable"}))
            .await
            .unwrap();
        let old_token = reg_result["token"].as_str().unwrap().to_string();

        // Rotate token
        let rotate = WebhookRotatePrimitive::new(
            ctx,
            "test-agent".into(),
            home.clone(),
            "https://moxxy.example.com".into(),
            index.clone(),
        );
        let result = rotate
            .invoke(serde_json::json!({
                "slug": "rotatable",
                "rotate_token": true,
            }))
            .await
            .unwrap();
        assert_eq!(result["status"], "rotated");
        assert_eq!(result["token_rotated"], true);

        // Verify new token in doc
        let doc = WebhookStore::load(&home, "test-agent", "rotatable").unwrap();
        assert_ne!(doc.token, old_token);

        // Verify index updated: old token gone, new token present
        let idx = index.read().unwrap();
        assert!(idx.get(&old_token).is_none());
        assert_eq!(idx.len(), 1);
    }

    #[tokio::test]
    async fn webhook_rotate_adds_secret() {
        let (ctx, home, index) = setup();

        // Register without secret
        let register = WebhookRegisterPrimitive::new(
            ctx.clone(),
            "test-agent".into(),
            home.clone(),
            "https://moxxy.example.com".into(),
            index.clone(),
        );
        register
            .invoke(serde_json::json!({"label": "No Secret Yet"}))
            .await
            .unwrap();

        // Rotate to add a secret
        let rotate = WebhookRotatePrimitive::new(
            ctx,
            "test-agent".into(),
            home.clone(),
            "https://moxxy.example.com".into(),
            index,
        );
        let result = rotate
            .invoke(serde_json::json!({
                "slug": "no-secret-yet",
                "rotate_token": false,
                "rotate_secret": true,
                "new_secret": "my-new-hmac-secret",
            }))
            .await
            .unwrap();
        assert_eq!(result["status"], "rotated");
        assert_eq!(result["has_secret"], true);
        assert_eq!(result["new_secret"], "my-new-hmac-secret");

        // Verify persisted
        let doc = WebhookStore::load(&home, "test-agent", "no-secret-yet").unwrap();
        assert!(doc.secret_ref.is_some());
    }

    // Helper to register a webhook and return (slug, token)
    async fn register_webhook(
        ctx: &PrimitiveContext,
        home: &PathBuf,
        index: &Arc<RwLock<HashMap<String, LoadedWebhook>>>,
        label: &str,
    ) -> (String, String) {
        let register = WebhookRegisterPrimitive::new(
            ctx.clone(),
            "test-agent".into(),
            home.clone(),
            "https://moxxy.example.com".into(),
            index.clone(),
        );
        let result = register
            .invoke(serde_json::json!({"label": label}))
            .await
            .unwrap();
        let slug = result["slug"].as_str().unwrap().to_string();
        let token = result["token"].as_str().unwrap().to_string();
        (slug, token)
    }

    #[tokio::test]
    async fn webhook_listen_receives_payload() {
        let (ctx, home, index) = setup();
        let listen_channels = new_webhook_listen_channels();

        let (slug, token) = register_webhook(&ctx, &home, &index, "Listen Test").await;

        let listen = WebhookListenPrimitive::new(
            "test-agent".into(),
            home.clone(),
            index.clone(),
            listen_channels.clone(),
        );

        // Spawn listen in background
        let listen_handle = tokio::spawn(async move {
            listen
                .invoke(serde_json::json!({
                    "slug": slug,
                    "timeout_seconds": 5,
                }))
                .await
        });

        // Wait for listener to register
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;

        // Send payload via channels (simulating webhook handler)
        let payload = serde_json::json!({
            "event_type": "push",
            "headers": {},
            "body": {"action": "opened"},
            "source_ip": "127.0.0.1",
        });
        {
            let mut channels = listen_channels.lock().unwrap();
            let tx = channels.remove(&token).unwrap();
            tx.send(payload.clone()).unwrap();
        }

        let result = listen_handle.await.unwrap().unwrap();
        assert_eq!(result["event_type"], "push");
        assert_eq!(result["body"]["action"], "opened");
    }

    #[tokio::test]
    async fn webhook_listen_times_out() {
        let (ctx, home, index) = setup();
        let listen_channels = new_webhook_listen_channels();

        let (slug, token) = register_webhook(&ctx, &home, &index, "Timeout Test").await;

        let listen = WebhookListenPrimitive::new(
            "test-agent".into(),
            home.clone(),
            index.clone(),
            listen_channels.clone(),
        );

        let result = listen
            .invoke(serde_json::json!({
                "slug": slug,
                "timeout_seconds": 1,
            }))
            .await;

        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), PrimitiveError::Timeout));

        // Verify cleanup: channel should be removed
        let channels = listen_channels.lock().unwrap();
        assert!(!channels.contains_key(&token));
    }

    #[tokio::test]
    async fn webhook_listen_slug_not_found() {
        let (_ctx, home, index) = setup();
        let listen_channels = new_webhook_listen_channels();

        let listen = WebhookListenPrimitive::new(
            "test-agent".into(),
            home.clone(),
            index.clone(),
            listen_channels,
        );

        let result = listen
            .invoke(serde_json::json!({"slug": "nonexistent"}))
            .await;

        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), PrimitiveError::NotFound(_)));
    }

    #[tokio::test]
    async fn webhook_listen_already_listening() {
        let (ctx, home, index) = setup();
        let listen_channels = new_webhook_listen_channels();

        let (slug, token) = register_webhook(&ctx, &home, &index, "Double Listen").await;

        // Pre-insert a sender to simulate an existing listener
        {
            let (tx, _rx) = oneshot::channel::<serde_json::Value>();
            let mut channels = listen_channels.lock().unwrap();
            channels.insert(token, tx);
        }

        let listen = WebhookListenPrimitive::new(
            "test-agent".into(),
            home.clone(),
            index.clone(),
            listen_channels,
        );

        let result = listen.invoke(serde_json::json!({"slug": slug})).await;

        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(matches!(err, PrimitiveError::ExecutionFailed(_)));
        assert!(err.to_string().contains("another listener"));
    }

    #[tokio::test]
    async fn webhook_register_with_body() {
        let (ctx, home, index) = setup();
        let prim = WebhookRegisterPrimitive::new(
            ctx,
            "test-agent".into(),
            home.clone(),
            "https://moxxy.example.com".into(),
            index,
        );
        let result = prim
            .invoke(serde_json::json!({
                "label": "Body Hook",
                "body": "Review PR {{body.number}} by {{body.user.login}}"
            }))
            .await
            .unwrap();

        assert_eq!(result["status"], "registered");
        assert_eq!(result["has_body"], true);

        // Verify persisted in doc
        let doc = WebhookStore::load(&home, "test-agent", "body-hook").unwrap();
        assert!(doc.body.contains("Review PR"));
    }

    #[tokio::test]
    async fn webhook_update_sets_body() {
        let (ctx, home, index) = setup();

        // Register without body
        let register = WebhookRegisterPrimitive::new(
            ctx,
            "test-agent".into(),
            home.clone(),
            "https://moxxy.example.com".into(),
            index.clone(),
        );
        register
            .invoke(serde_json::json!({"label": "Plain Hook"}))
            .await
            .unwrap();

        // Update to add body
        let update = WebhookUpdatePrimitive::new("test-agent".into(), home.clone(), index);
        let result = update
            .invoke(serde_json::json!({
                "slug": "plain-hook",
                "body": "Handle {{event_type}} event"
            }))
            .await
            .unwrap();
        assert_eq!(result["status"], "updated");
        assert_eq!(result["has_body"], true);

        // Verify persisted
        let doc = WebhookStore::load(&home, "test-agent", "plain-hook").unwrap();
        assert!(doc.body.contains("Handle"));
    }

    #[tokio::test]
    async fn webhook_listen_missing_slug() {
        let (_ctx, home, index) = setup();
        let listen_channels = new_webhook_listen_channels();

        let listen = WebhookListenPrimitive::new(
            "test-agent".into(),
            home.clone(),
            index.clone(),
            listen_channels,
        );

        let result = listen.invoke(serde_json::json!({})).await;

        assert!(result.is_err());
        assert!(matches!(
            result.unwrap_err(),
            PrimitiveError::InvalidParams(_)
        ));
    }
}
