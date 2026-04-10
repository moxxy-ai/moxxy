//! Headless browser support backed by a Playwright Node.js sidecar.
//!
//! The Rust side runs a per-agent supervised child process that speaks
//! line-delimited JSON-RPC over stdio (see `sidecars/playwright/sidecar.mjs`).
//! Node, `playwright-core`, and Chromium are downloaded on demand on the first
//! browser primitive call into `~/.moxxy/runtimes/` and `~/.moxxy/sidecars/`.

pub mod bootstrap;
pub mod config;
pub mod manager;
pub mod protocol;
pub mod sidecar;

pub use config::BrowserConfig;
pub use manager::BrowserManager;
pub use protocol::{RpcError, RpcRequest, RpcResponse};
