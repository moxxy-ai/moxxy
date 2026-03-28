use async_trait::async_trait;
use wasmtime::Module;

use crate::PluginError;
use crate::host::{WasmHost, WasmInstance};
use crate::manifest::PluginManifest;
use moxxy_runtime::PrimitiveError;
use moxxy_runtime::provider::{Message, ModelConfig, Provider, ProviderResponse};
use moxxy_runtime::registry::ToolDefinition;

/// A Provider implementation backed by a WASM module.
/// Creates a fresh WasmInstance per call to prevent state leakage.
pub struct WasmProvider {
    host: WasmHost,
    module: Module,
    manifest: PluginManifest,
}

impl WasmProvider {
    pub fn new(host: WasmHost, module: Module, manifest: PluginManifest) -> Self {
        Self {
            host,
            module,
            manifest,
        }
    }

    pub fn provider_id(&self) -> &str {
        &self.manifest.provider_id
    }

    /// Get provider info from the WASM module.
    pub fn provider_info(&self) -> Result<serde_json::Value, PluginError> {
        let mut instance =
            WasmInstance::new(self.host.engine(), &self.module, self.host.fuel_limit())?;
        instance.call_provider_info()
    }
}

#[async_trait]
impl Provider for WasmProvider {
    async fn complete(
        &self,
        messages: Vec<Message>,
        config: &ModelConfig,
        _tools: &[ToolDefinition],
    ) -> Result<ProviderResponse, PrimitiveError> {
        let messages_json: Vec<serde_json::Value> = messages
            .iter()
            .map(|m| {
                serde_json::json!({
                    "role": m.role,
                    "content": m.content,
                })
            })
            .collect();
        let msgs_str = serde_json::to_string(&messages_json)
            .map_err(|e| PrimitiveError::ExecutionFailed(e.to_string()))?;
        let config_str = serde_json::json!({
            "temperature": config.temperature,
            "max_tokens": config.max_tokens,
        })
        .to_string();

        let mut instance =
            WasmInstance::new(self.host.engine(), &self.module, self.host.fuel_limit())
                .map_err(|e| PrimitiveError::ExecutionFailed(e.to_string()))?;

        let result_str = instance
            .call_complete(&msgs_str, &config_str)
            .map_err(|e| PrimitiveError::ExecutionFailed(e.to_string()))?;

        let result: serde_json::Value = serde_json::from_str(&result_str)
            .map_err(|e| PrimitiveError::ExecutionFailed(e.to_string()))?;

        let content = result["content"].as_str().unwrap_or("").to_string();

        let tool_calls = result["tool_calls"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .enumerate()
                    .filter_map(|(i, tc)| {
                        Some(moxxy_runtime::ToolCall {
                            id: tc["id"]
                                .as_str()
                                .map(|s| s.to_string())
                                .unwrap_or_else(|| format!("call_{i}")),
                            name: tc["name"].as_str()?.to_string(),
                            arguments: tc["arguments"].clone(),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();

        Ok(ProviderResponse {
            content,
            tool_calls,
            usage: None,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_wat_module() -> Vec<u8> {
        wat::parse_str(
            r#"
            (module
                (import "env" "host_log" (func $host_log (param i32 i32 i32)))
                (memory (export "memory") 1)
                (data (i32.const 0) "{\"name\":\"test\",\"version\":\"1.0\"}")
                (data (i32.const 64) "{\"content\":\"wasm hello\",\"tool_calls\":[]}")
                (global $bump (mut i32) (i32.const 256))
                (func $alloc (export "alloc") (param $size i32) (result i32)
                    (local $ptr i32)
                    (local.set $ptr (global.get $bump))
                    (global.set $bump (i32.add (global.get $bump) (local.get $size)))
                    (local.get $ptr)
                )
                (func $provider_info (export "provider_info") (result i64)
                    (i64.const 31)
                )
                (func $complete (export "complete")
                    (param $msgs_ptr i32) (param $msgs_len i32)
                    (param $cfg_ptr i32) (param $cfg_len i32)
                    (result i64)
                    (i64.or
                        (i64.shl (i64.const 64) (i64.const 32))
                        (i64.const 40)
                    )
                )
            )
        "#,
        )
        .expect("failed to parse WAT")
    }

    #[test]
    fn wasm_provider_returns_provider_info() {
        let host = WasmHost::new(1_000_000, 256 * 1024 * 1024);
        let wasm = test_wat_module();
        let compiled = host.compile(&wasm).unwrap();
        let manifest = PluginManifest {
            provider_id: "test-provider".into(),
            wasm_path: "test.wasm".into(),
            sig_path: None,
            allowed_domains: vec![],
            fuel_limit: 1_000_000,
            memory_limit_bytes: 256 * 1024 * 1024,
        };

        let provider = WasmProvider::new(host, compiled.module, manifest);
        let info = provider.provider_info().unwrap();
        assert_eq!(info["name"], "test");
    }

    #[tokio::test]
    async fn wasm_provider_implements_provider_trait() {
        let host = WasmHost::new(1_000_000, 256 * 1024 * 1024);
        let wasm = test_wat_module();
        let compiled = host.compile(&wasm).unwrap();
        let manifest = PluginManifest {
            provider_id: "test-provider".into(),
            wasm_path: "test.wasm".into(),
            sig_path: None,
            allowed_domains: vec![],
            fuel_limit: 1_000_000,
            memory_limit_bytes: 256 * 1024 * 1024,
        };

        let provider = WasmProvider::new(host, compiled.module, manifest);
        let config = ModelConfig {
            temperature: 0.7,
            max_tokens: 100,
            tool_choice: moxxy_runtime::ToolChoice::Auto,
        };
        let messages = vec![Message::user("hello")];

        let resp = provider.complete(messages, &config, &[]).await.unwrap();
        assert_eq!(resp.content, "wasm hello");
        assert!(resp.tool_calls.is_empty());
    }

    #[tokio::test]
    async fn wasm_provider_instance_per_call_isolation() {
        let host = WasmHost::new(1_000_000, 256 * 1024 * 1024);
        let wasm = test_wat_module();
        let compiled = host.compile(&wasm).unwrap();
        let manifest = PluginManifest {
            provider_id: "test-provider".into(),
            wasm_path: "test.wasm".into(),
            sig_path: None,
            allowed_domains: vec![],
            fuel_limit: 1_000_000,
            memory_limit_bytes: 256 * 1024 * 1024,
        };

        let provider = WasmProvider::new(host, compiled.module, manifest);
        let config = ModelConfig {
            temperature: 0.7,
            max_tokens: 100,
            tool_choice: moxxy_runtime::ToolChoice::Auto,
        };

        // Call twice to verify no state leaks between calls
        for _ in 0..2 {
            let messages = vec![Message::user("test")];
            let resp = provider.complete(messages, &config, &[]).await.unwrap();
            assert_eq!(resp.content, "wasm hello");
        }
    }
}
