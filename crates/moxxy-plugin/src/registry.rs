use std::collections::HashMap;
use std::sync::Arc;

use crate::PluginError;
use crate::host::WasmHost;
use crate::manifest::PluginManifest;
use crate::wasm_provider::WasmProvider;

pub struct PluginRegistry {
    plugins: HashMap<String, Arc<WasmProvider>>,
}

impl Default for PluginRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl PluginRegistry {
    pub fn new() -> Self {
        Self {
            plugins: HashMap::new(),
        }
    }

    pub fn load(&mut self, manifest: PluginManifest, wasm_bytes: &[u8]) -> Result<(), PluginError> {
        let host = WasmHost::new(manifest.fuel_limit, manifest.memory_limit_bytes);
        let compiled = host.compile(wasm_bytes)?;
        let provider_id = manifest.provider_id.clone();
        let provider = WasmProvider::new(host, compiled.module, manifest);
        self.plugins.insert(provider_id, Arc::new(provider));
        Ok(())
    }

    pub fn get(&self, provider_id: &str) -> Option<Arc<WasmProvider>> {
        self.plugins.get(provider_id).cloned()
    }

    pub fn unload(&mut self, provider_id: &str) -> bool {
        self.plugins.remove(provider_id).is_some()
    }

    pub fn list(&self) -> Vec<String> {
        self.plugins.keys().cloned().collect()
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
                (data (i32.const 64) "{\"content\":\"echo\",\"tool_calls\":[]}")
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
                    (param i32 i32 i32 i32) (result i64)
                    (i64.or
                        (i64.shl (i64.const 64) (i64.const 32))
                        (i64.const 34)
                    )
                )
            )
        "#,
        )
        .expect("failed to parse WAT")
    }

    fn test_manifest(id: &str) -> PluginManifest {
        PluginManifest {
            provider_id: id.into(),
            wasm_path: "test.wasm".into(),
            sig_path: None,
            allowed_domains: vec![],
            fuel_limit: 1_000_000,
            memory_limit_bytes: 256 * 1024 * 1024,
        }
    }

    #[test]
    fn registry_load_and_get() {
        let mut registry = PluginRegistry::new();
        let wasm = test_wat_module();
        registry.load(test_manifest("p1"), &wasm).unwrap();

        let provider = registry.get("p1");
        assert!(provider.is_some());
        assert_eq!(provider.unwrap().provider_id(), "p1");
    }

    #[test]
    fn registry_get_missing_returns_none() {
        let registry = PluginRegistry::new();
        assert!(registry.get("missing").is_none());
    }

    #[test]
    fn registry_unload() {
        let mut registry = PluginRegistry::new();
        let wasm = test_wat_module();
        registry.load(test_manifest("p1"), &wasm).unwrap();
        assert!(registry.unload("p1"));
        assert!(registry.get("p1").is_none());
    }

    #[test]
    fn registry_unload_missing_returns_false() {
        let mut registry = PluginRegistry::new();
        assert!(!registry.unload("missing"));
    }

    #[test]
    fn registry_list() {
        let mut registry = PluginRegistry::new();
        let wasm = test_wat_module();
        registry.load(test_manifest("alpha"), &wasm).unwrap();
        registry.load(test_manifest("beta"), &wasm).unwrap();

        let mut names = registry.list();
        names.sort();
        assert_eq!(names, vec!["alpha", "beta"]);
    }

    #[test]
    fn registry_load_replaces_existing() {
        let mut registry = PluginRegistry::new();
        let wasm = test_wat_module();
        registry.load(test_manifest("p1"), &wasm).unwrap();
        registry.load(test_manifest("p1"), &wasm).unwrap();
        assert_eq!(registry.list().len(), 1);
    }
}
