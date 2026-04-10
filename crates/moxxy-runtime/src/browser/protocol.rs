//! JSON-RPC types matching `sidecars/playwright/sidecar.mjs`.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
pub struct RpcRequest {
    pub id: u64,
    pub method: String,
    pub params: serde_json::Value,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RpcResponse {
    pub id: Option<u64>,
    pub ok: bool,
    #[serde(default)]
    pub result: Option<serde_json::Value>,
    #[serde(default)]
    pub error: Option<RpcError>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct RpcError {
    pub code: String,
    pub message: String,
}

impl RpcError {
    pub fn is_transient(&self) -> bool {
        matches!(self.code.as_str(), "timeout" | "network")
    }
}
