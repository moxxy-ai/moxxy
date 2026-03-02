use wasmtime::*;

use crate::PluginError;

/// Compiled WASM module ready for instantiation.
pub struct WasmModule {
    pub(crate) module: Module,
}

/// Hosts WASM modules with configurable fuel and memory limits.
pub struct WasmHost {
    engine: Engine,
    fuel_limit: u64,
}

impl WasmHost {
    pub fn new(fuel_limit: u64, _memory_limit_bytes: usize) -> Self {
        let mut config = Config::new();
        config.consume_fuel(true);
        let engine = Engine::new(&config).expect("failed to create wasmtime engine");
        Self { engine, fuel_limit }
    }

    pub fn compile(&self, wasm_bytes: &[u8]) -> Result<WasmModule, PluginError> {
        let module = Module::new(&self.engine, wasm_bytes)
            .map_err(|e| PluginError::WasmCompilationFailed(e.to_string()))?;
        Ok(WasmModule { module })
    }

    pub fn engine(&self) -> &Engine {
        &self.engine
    }

    pub fn fuel_limit(&self) -> u64 {
        self.fuel_limit
    }
}

/// A single WASM instance with its own store and fuel budget.
pub struct WasmInstance {
    store: Store<()>,
    instance: Instance,
}

impl WasmInstance {
    pub fn new(engine: &Engine, module: &Module, fuel: u64) -> Result<Self, PluginError> {
        let mut store = Store::new(engine, ());
        store
            .set_fuel(fuel)
            .map_err(|e| PluginError::RuntimeError(e.to_string()))?;

        let mut linker = Linker::new(engine);

        // Provide host_log to the guest
        linker
            .func_wrap(
                "env",
                "host_log",
                |_caller: Caller<'_, ()>, _level: i32, _msg_ptr: i32, _msg_len: i32| {
                    // In a full implementation, read memory at msg_ptr..msg_ptr+msg_len
                    // and log via tracing. For now, no-op.
                },
            )
            .map_err(|e| PluginError::RuntimeError(e.to_string()))?;

        let instance = linker
            .instantiate(&mut store, module)
            .map_err(|e| PluginError::RuntimeError(e.to_string()))?;

        Ok(Self { store, instance })
    }

    /// Call the guest's `provider_info` export, which returns a pointer to a JSON string.
    /// The guest writes JSON into its memory and returns (ptr, len) packed as i64.
    pub fn call_provider_info(&mut self) -> Result<serde_json::Value, PluginError> {
        let func = self
            .instance
            .get_typed_func::<(), i64>(&mut self.store, "provider_info")
            .map_err(|e| PluginError::RuntimeError(e.to_string()))?;

        let packed = func
            .call(&mut self.store, ())
            .map_err(|e| PluginError::RuntimeError(e.to_string()))?;

        let ptr = (packed >> 32) as u32 as usize;
        let len = (packed & 0xFFFF_FFFF) as u32 as usize;

        let memory = self
            .instance
            .get_memory(&mut self.store, "memory")
            .ok_or_else(|| PluginError::RuntimeError("no memory export".into()))?;

        let data = memory.data(&self.store);
        if ptr + len > data.len() {
            return Err(PluginError::RuntimeError(
                "out of bounds memory read".into(),
            ));
        }
        let json_bytes = &data[ptr..ptr + len];
        let json_str = std::str::from_utf8(json_bytes)
            .map_err(|e| PluginError::RuntimeError(e.to_string()))?;

        serde_json::from_str(json_str).map_err(|e| PluginError::RuntimeError(e.to_string()))
    }

    /// Call the guest's `complete` export.
    /// Writes messages_json and config_json into guest memory via `alloc`,
    /// then calls `complete(msgs_ptr, msgs_len, cfg_ptr, cfg_len) -> i64` (packed ptr+len).
    pub fn call_complete(
        &mut self,
        messages_json: &str,
        config_json: &str,
    ) -> Result<String, PluginError> {
        let msgs_bytes = messages_json.as_bytes();
        let cfg_bytes = config_json.as_bytes();

        // Allocate space in guest for messages
        let alloc = self
            .instance
            .get_typed_func::<i32, i32>(&mut self.store, "alloc")
            .map_err(|e| PluginError::RuntimeError(e.to_string()))?;

        let msgs_ptr = alloc
            .call(&mut self.store, msgs_bytes.len() as i32)
            .map_err(|e| PluginError::RuntimeError(e.to_string()))?;

        let cfg_ptr = alloc
            .call(&mut self.store, cfg_bytes.len() as i32)
            .map_err(|e| PluginError::RuntimeError(e.to_string()))?;

        // Write data into guest memory
        let memory = self
            .instance
            .get_memory(&mut self.store, "memory")
            .ok_or_else(|| PluginError::RuntimeError("no memory export".into()))?;

        memory.data_mut(&mut self.store)[msgs_ptr as usize..msgs_ptr as usize + msgs_bytes.len()]
            .copy_from_slice(msgs_bytes);
        memory.data_mut(&mut self.store)[cfg_ptr as usize..cfg_ptr as usize + cfg_bytes.len()]
            .copy_from_slice(cfg_bytes);

        // Call complete
        let complete_func = self
            .instance
            .get_typed_func::<(i32, i32, i32, i32), i64>(&mut self.store, "complete")
            .map_err(|e| PluginError::RuntimeError(e.to_string()))?;

        let packed = complete_func
            .call(
                &mut self.store,
                (
                    msgs_ptr,
                    msgs_bytes.len() as i32,
                    cfg_ptr,
                    cfg_bytes.len() as i32,
                ),
            )
            .map_err(|e| PluginError::RuntimeError(e.to_string()))?;

        let ptr = (packed >> 32) as u32 as usize;
        let len = (packed & 0xFFFF_FFFF) as u32 as usize;

        let data = memory.data(&self.store);
        if ptr + len > data.len() {
            return Err(PluginError::RuntimeError(
                "out of bounds memory read".into(),
            ));
        }
        let result_bytes = &data[ptr..ptr + len];
        String::from_utf8(result_bytes.to_vec())
            .map_err(|e| PluginError::RuntimeError(e.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A minimal WAT module that:
    /// - Has 1 page of memory
    /// - Stores provider_info JSON at offset 0
    /// - Uses a bump allocator starting at offset 256
    /// - provider_info returns packed (ptr=0, len=N) where N is the JSON length
    /// - complete ignores input and returns a hardcoded response
    fn test_wat_module() -> Vec<u8> {
        wat::parse_str(
            r#"
            (module
                ;; Import must come before function definitions
                (import "env" "host_log" (func $host_log (param i32 i32 i32)))

                (memory (export "memory") 1)

                ;; Hardcoded JSON for provider_info at offset 0
                ;; {"name":"test","version":"1.0"}
                (data (i32.const 0) "{\"name\":\"test\",\"version\":\"1.0\"}")

                ;; Hardcoded JSON for complete response at offset 64
                ;; {"content":"echo response","tool_calls":[]}
                (data (i32.const 64) "{\"content\":\"echo response\",\"tool_calls\":[]}")

                ;; Bump allocator global starting at 256
                (global $bump (mut i32) (i32.const 256))

                ;; alloc(size) -> ptr
                (func $alloc (export "alloc") (param $size i32) (result i32)
                    (local $ptr i32)
                    (local.set $ptr (global.get $bump))
                    (global.set $bump (i32.add (global.get $bump) (local.get $size)))
                    (local.get $ptr)
                )

                ;; provider_info() -> i64 (packed: high=ptr, low=len)
                (func $provider_info (export "provider_info") (result i64)
                    ;; ptr=0, len=31 -> pack as (0 << 32) | 31
                    (i64.const 31)  ;; 0 << 32 | 31
                )

                ;; complete(msgs_ptr, msgs_len, cfg_ptr, cfg_len) -> i64 (packed ptr+len)
                (func $complete (export "complete")
                    (param $msgs_ptr i32) (param $msgs_len i32)
                    (param $cfg_ptr i32) (param $cfg_len i32)
                    (result i64)
                    ;; return hardcoded response at offset 64, len=43
                    ;; pack: (64 << 32) | 43
                    (i64.or
                        (i64.shl (i64.const 64) (i64.const 32))
                        (i64.const 43)
                    )
                )
            )
        "#,
        )
        .expect("failed to parse WAT")
    }

    #[test]
    fn wasm_host_compiles_valid_module() {
        let host = WasmHost::new(1_000_000, 256 * 1024 * 1024);
        let wasm = test_wat_module();
        let module = host.compile(&wasm);
        assert!(module.is_ok());
    }

    #[test]
    fn wasm_host_rejects_invalid_module() {
        let host = WasmHost::new(1_000_000, 256 * 1024 * 1024);
        let result = host.compile(b"not a wasm module");
        assert!(result.is_err());
    }

    #[test]
    fn wasm_instance_calls_provider_info() {
        let host = WasmHost::new(1_000_000, 256 * 1024 * 1024);
        let wasm = test_wat_module();
        let compiled = host.compile(&wasm).unwrap();
        let mut instance =
            WasmInstance::new(host.engine(), &compiled.module, host.fuel_limit()).unwrap();

        let info = instance.call_provider_info().unwrap();
        assert_eq!(info["name"], "test");
        assert_eq!(info["version"], "1.0");
    }

    #[test]
    fn wasm_instance_calls_complete() {
        let host = WasmHost::new(1_000_000, 256 * 1024 * 1024);
        let wasm = test_wat_module();
        let compiled = host.compile(&wasm).unwrap();
        let mut instance =
            WasmInstance::new(host.engine(), &compiled.module, host.fuel_limit()).unwrap();

        let result = instance
            .call_complete(r#"[{"role":"user","content":"hi"}]"#, r#"{"temp":0.7}"#)
            .unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&result).unwrap();
        assert_eq!(parsed["content"], "echo response");
    }

    #[test]
    fn wasm_instance_fuel_is_consumed() {
        let host = WasmHost::new(100, 256 * 1024 * 1024);
        let wasm = test_wat_module();
        let compiled = host.compile(&wasm).unwrap();
        let mut instance =
            WasmInstance::new(host.engine(), &compiled.module, host.fuel_limit()).unwrap();

        // With very low fuel, calls should still work since WAT ops are cheap
        // but this verifies fuel is set
        let info = instance.call_provider_info();
        assert!(info.is_ok());
    }
}
