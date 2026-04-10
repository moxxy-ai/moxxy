use std::sync::Arc;

use async_trait::async_trait;

use crate::browser::BrowserManager;
use crate::registry::{Primitive, PrimitiveError};

pub struct BrowserSessionOpenPrimitive {
    manager: Arc<BrowserManager>,
}

impl BrowserSessionOpenPrimitive {
    pub fn new(manager: Arc<BrowserManager>) -> Self {
        Self { manager }
    }
}

#[async_trait]
impl Primitive for BrowserSessionOpenPrimitive {
    fn name(&self) -> &str {
        "browser.session.open"
    }
    fn description(&self) -> &str {
        "Open a new isolated browser session (cookie/storage jar). Returns a session_id \
         that subsequent browser.* calls reference. Sessions persist until closed or until \
         the per-agent sidecar is idle-killed."
    }
    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "user_agent": {"type": "string"},
                "viewport": {
                    "type": "object",
                    "properties": {
                        "width": {"type": "integer"},
                        "height": {"type": "integer"}
                    }
                },
                "locale": {"type": "string"},
                "ignore_https_errors": {"type": "boolean"}
            }
        })
    }
    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        self.manager.request("session.create", params, None).await
    }
}

pub struct BrowserSessionClosePrimitive {
    manager: Arc<BrowserManager>,
}

impl BrowserSessionClosePrimitive {
    pub fn new(manager: Arc<BrowserManager>) -> Self {
        Self { manager }
    }
}

#[async_trait]
impl Primitive for BrowserSessionClosePrimitive {
    fn name(&self) -> &str {
        "browser.session.close"
    }
    fn description(&self) -> &str {
        "Close a browser session, releasing all of its tabs and cookies."
    }
    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "session_id": {"type": "string"}
            },
            "required": ["session_id"]
        })
    }
    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        self.manager.request("session.close", params, None).await
    }
}

pub struct BrowserSessionListPrimitive {
    manager: Arc<BrowserManager>,
}

impl BrowserSessionListPrimitive {
    pub fn new(manager: Arc<BrowserManager>) -> Self {
        Self { manager }
    }
}

#[async_trait]
impl Primitive for BrowserSessionListPrimitive {
    fn name(&self) -> &str {
        "browser.session.list"
    }
    fn description(&self) -> &str {
        "List all currently open browser sessions and the pages each one holds."
    }
    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({"type": "object", "properties": {}})
    }
    async fn invoke(
        &self,
        _params: serde_json::Value,
    ) -> Result<serde_json::Value, PrimitiveError> {
        self.manager
            .request("session.list", serde_json::json!({}), None)
            .await
    }
}
