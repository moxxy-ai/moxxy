# WASI Providers

Moxxy supports running provider plugins as WebAssembly modules via WASI (WebAssembly System Interface). This enables sandboxed, portable provider execution with configurable resource limits.

## Architecture

```
+------------------+     +-----------------+     +-------------+
| PluginRegistry   |     | WasmHost        |     | WasmInstance|
| - load manifest  | --> | - Wasmtime      | --> | - WASI env  |
| - verify sig     |     | - fuel limits   |     | - host fns  |
| - create host    |     | - memory limits |     | - guest ABI |
+------------------+     +-----------------+     +-------------+
         |
         v
+------------------+
| WasmProvider     |  Implements Provider trait
| - delegates to   |  by calling into WASM guest
|   WasmInstance   |
+------------------+
```

## Plugin Manifest

Every WASI provider needs a YAML manifest:

```yaml
provider_id: my-provider
wasm_path: /path/to/module.wasm
sig_path: /path/to/module.sig       # Optional
allowed_domains:
  - api.example.com
fuel_limit: 1000000000
memory_limit_bytes: 268435456
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `provider_id` | string | Yes | -- | Unique provider identifier |
| `wasm_path` | string | Yes | -- | Path to the WASM module |
| `sig_path` | string | No | null | Path to Ed25519 signature file |
| `allowed_domains` | string[] | No | `[]` | Domains the plugin can access |
| `fuel_limit` | integer | No | 1,000,000,000 | Maximum Wasmtime fuel (computation budget) |
| `memory_limit_bytes` | integer | No | 268,435,456 (256 MB) | Maximum linear memory |

## WasmHost

The `WasmHost` configures the Wasmtime engine:

- **Fuel metering**: Limits total computation. When fuel runs out, the module traps.
- **Memory limits**: Caps the WASM linear memory to prevent runaway allocations.
- **WASI capabilities**: Standard I/O, filesystem access (scoped), environment variables.

```rust
let host = WasmHost::new(fuel_limit, memory_limit_bytes)?;
let instance = host.instantiate(&wasm_bytes)?;
```

## Guest ABI

WASM provider modules export functions that the host calls:

- `complete(messages_ptr, messages_len, config_ptr, config_len) -> result_ptr`

Messages and configuration are serialized as JSON, passed to the guest via shared memory, and the response is read back.

## Signature Verification

The `SignatureVerifier` validates WASM module integrity using Ed25519 signatures:

1. Load the public key (configured at build time)
2. Read the signature file (`.sig`)
3. Verify the WASM binary against the signature
4. If verification fails, the plugin is rejected

This prevents loading tampered or unauthorized plugins.

```rust
let verifier = SignatureVerifier::new(public_key);
verifier.verify(&wasm_bytes, &signature_bytes)?;
```

## PluginRegistry

The `PluginRegistry` manages the lifecycle of loaded plugins:

```rust
let mut registry = PluginRegistry::new();

// Load a plugin from a manifest
registry.load("/path/to/manifest.yaml")?;

// Get a provider
let provider = registry.get("my-provider")?;
```

The registry:
1. Parses the YAML manifest
2. Optionally verifies the module signature
3. Creates a `WasmHost` with the configured limits
4. Instantiates the module
5. Wraps it in a `WasmProvider` that implements the `Provider` trait

## Resource Limits

| Resource | Default | Description |
|----------|---------|-------------|
| Fuel | 1,000,000,000 | Computation budget (roughly proportional to instructions executed) |
| Memory | 256 MB | Maximum WASM linear memory |
| Domains | `[]` (none) | Network access allowlist |

If a module exhausts its fuel, Wasmtime raises a trap that is caught and returned as `PrimitiveError::ExecutionFailed`.

If memory allocation exceeds the limit, Wasmtime returns an out-of-memory error.

## Building a WASM Provider

### Prerequisites

- Rust with the `wasm32-wasip1` target: `rustup target add wasm32-wasip1`
- `wasmtime` CLI (for testing): `cargo install wasmtime-cli`

### Step 1: Create a new Rust project

```bash
cargo new my-provider --lib
cd my-provider
```

### Step 2: Implement the guest ABI

```rust
// src/lib.rs
use std::io::{self, Read, Write};

#[no_mangle]
pub extern "C" fn complete(
    messages_ptr: *const u8,
    messages_len: usize,
    config_ptr: *const u8,
    config_len: usize,
) -> *const u8 {
    // Deserialize messages and config from JSON
    // Call your LLM API
    // Serialize the response
    // Return a pointer to the response buffer
    todo!()
}
```

### Step 3: Build for WASI

```bash
cargo build --target wasm32-wasip1 --release
```

### Step 4: Create the manifest

```yaml
provider_id: my-provider
wasm_path: target/wasm32-wasip1/release/my_provider.wasm
allowed_domains:
  - api.my-llm.com
```

### Step 5: Optionally sign the module

```bash
# Generate a keypair
moxxy plugin keygen --output my-provider.key

# Sign the module
moxxy plugin sign --key my-provider.key --wasm target/.../my_provider.wasm --output my_provider.sig
```

### Step 6: Load the plugin

```bash
curl -X POST http://localhost:3000/v1/providers \
  -H "Authorization: Bearer $MOXXY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"id": "my-provider", "display_name": "My WASI Provider", "manifest_path": "/path/to/manifest.yaml"}'
```
