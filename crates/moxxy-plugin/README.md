# moxxy-plugin

WASI-based plugin system for loading and executing WebAssembly modules as LLM providers.

## Overview

This crate enables Moxxy to run third-party WASM plugins in a sandboxed environment. Each plugin implements the `Provider` trait via a guest interface, allowing custom LLM backends to be loaded at runtime with resource constraints and cryptographic verification.

## Components

| Export | Description |
|---|---|
| `WasmHost` | Wasmtime engine that compiles WASM bytes into executable modules |
| `WasmInstance` | Isolated execution context with fuel budget and memory limits |
| `WasmProvider` | Wraps a WASM module as a `Provider` (fresh instance per call) |
| `PluginRegistry` | In-memory registry for loading, listing, and unloading plugins |
| `PluginManifest` | YAML config schema (wasm path, limits, allowed domains, signature) |
| `SignatureVerifier` | Ed25519 verification of WASM module integrity |

## Plugin Execution Flow

1. **Load** -- Host reads a YAML manifest, compiles WASM bytes, optionally verifies Ed25519 signature
2. **Instantiate** -- Each call creates a fresh `WasmInstance` (no state leakage between calls)
3. **Execute** -- Host serializes messages/config to JSON, writes into guest memory, calls `complete()` export
4. **Enforce** -- Fuel limits prevent runaway computation; memory limits cap allocation; WASI sandboxes I/O

## Guest Interface

WASM modules must export:

```
memory                                          Shared linear memory
alloc(size: i32) -> i32                         Bump allocator
provider_info() -> i64                          Returns metadata JSON (packed ptr+len)
complete(msgs_ptr, msgs_len, cfg_ptr, cfg_len) -> i64  Returns completion JSON
```

## Manifest Example

```yaml
provider_id: my-plugin
wasm_path: ./plugins/my-plugin.wasm
sig_path: ./plugins/my-plugin.sig    # optional Ed25519 signature
allowed_domains:
  - api.example.com
fuel_limit: 1000000000               # default: 1 billion instructions
memory_limit_bytes: 268435456        # default: 256 MB
```

## Dependencies

- `wasmtime` / `wasmtime-wasi` -- WASM runtime with WASI support
- `ed25519-dalek` -- signature verification
- `moxxy-types` -- shared type definitions
