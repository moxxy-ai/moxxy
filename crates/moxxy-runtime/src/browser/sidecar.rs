//! `SidecarProcess`: spawns and talks to the Playwright Node sidecar.
//!
//! Owns:
//!   * `tokio::process::Child` — the Node process,
//!   * a writer half of stdin behind a `Mutex` (one writer at a time),
//!   * a background reader task that pumps stdout lines into per-request
//!     `oneshot` channels.
//!
//! On any I/O failure or unexpected EOF the sidecar is considered dead and
//! all in-flight requests get a transient `ExecutionFailed`. The
//! `BrowserManager` re-spawns on the next call.

use std::collections::HashMap;
use std::process::Stdio;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{Mutex, oneshot};

use super::bootstrap::InstalledSidecar;
use super::protocol::{RpcError, RpcResponse};
use crate::registry::PrimitiveError;

type Pending = Arc<Mutex<HashMap<u64, oneshot::Sender<RpcResponse>>>>;

pub struct SidecarProcess {
    child: Mutex<Child>,
    stdin: Mutex<ChildStdin>,
    next_id: AtomicU64,
    pending: Pending,
    /// Set to true once the reader task has observed EOF / decode failure.
    /// Subsequent requests fail fast instead of hanging.
    dead: Arc<std::sync::atomic::AtomicBool>,
}

impl SidecarProcess {
    pub async fn spawn(install: &InstalledSidecar) -> Result<Self, PrimitiveError> {
        // 64 MiB JSON line cap matches the screenshot ceiling + JSON overhead.
        const READ_LINE_CAP: usize = 64 * 1024 * 1024;

        tracing::info!(
            node = %install.node_bin.display(),
            script = %install.sidecar_script.display(),
            "spawning playwright sidecar",
        );

        let mut child = Command::new(&install.node_bin)
            .arg("--max-old-space-size=512")
            .arg(&install.sidecar_script)
            .env("PLAYWRIGHT_BROWSERS_PATH", &install.browsers_dir)
            .env("NODE_NO_WARNINGS", "1")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| exec(format!("spawn sidecar: {e}")))?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| exec("sidecar stdin not piped".into()))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| exec("sidecar stdout not piped".into()))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| exec("sidecar stderr not piped".into()))?;

        let pending: Pending = Arc::new(Mutex::new(HashMap::new()));
        let dead = Arc::new(std::sync::atomic::AtomicBool::new(false));

        // Stderr pump → tracing.
        spawn_stderr_pump(stderr);

        // Stdout pump → pending oneshots.
        {
            let pending = pending.clone();
            let dead = dead.clone();
            tokio::spawn(async move {
                let mut reader = BufReader::with_capacity(64 * 1024, stdout);
                let mut line = String::new();
                loop {
                    line.clear();
                    match read_capped_line(&mut reader, &mut line, READ_LINE_CAP).await {
                        Ok(0) => break, // EOF
                        Ok(_) => {}
                        Err(e) => {
                            tracing::warn!(error = %e, "sidecar stdout read error");
                            break;
                        }
                    }
                    let trimmed = line.trim_end_matches('\n').trim_end_matches('\r');
                    if trimmed.is_empty() {
                        continue;
                    }
                    let resp: RpcResponse = match serde_json::from_str(trimmed) {
                        Ok(r) => r,
                        Err(e) => {
                            tracing::warn!(error = %e, "sidecar response decode failed");
                            continue;
                        }
                    };
                    if let Some(id) = resp.id {
                        let mut map = pending.lock().await;
                        if let Some(tx) = map.remove(&id) {
                            let _ = tx.send(resp);
                        }
                    }
                }
                dead.store(true, Ordering::SeqCst);
                // Fail every still-pending request so they don't hang.
                let mut map = pending.lock().await;
                for (_, tx) in map.drain() {
                    let _ = tx.send(RpcResponse {
                        id: None,
                        ok: false,
                        result: None,
                        error: Some(RpcError {
                            code: "sidecar_dead".into(),
                            message: "sidecar process exited".into(),
                        }),
                    });
                }
                tracing::info!("sidecar reader task exited");
            });
        }

        Ok(Self {
            child: Mutex::new(child),
            stdin: Mutex::new(stdin),
            next_id: AtomicU64::new(1),
            pending,
            dead,
        })
    }

    /// Send a JSON-RPC request and await its response, with a hard timeout.
    pub async fn request(
        &self,
        method: &str,
        params: serde_json::Value,
        timeout: Duration,
    ) -> Result<serde_json::Value, PrimitiveError> {
        if self.dead.load(Ordering::SeqCst) {
            return Err(PrimitiveError::ExecutionFailed("sidecar is not running".into()));
        }
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let req = serde_json::json!({ "id": id, "method": method, "params": params });
        let line = serde_json::to_string(&req)
            .map_err(|e| exec(format!("encode request: {e}")))?;

        let (tx, rx) = oneshot::channel();
        {
            let mut map = self.pending.lock().await;
            map.insert(id, tx);
        }

        // Write atomically — only one writer holds the stdin lock at a time.
        {
            let mut stdin = self.stdin.lock().await;
            if let Err(e) = stdin.write_all(line.as_bytes()).await {
                self.pending.lock().await.remove(&id);
                return Err(exec(format!("write to sidecar: {e}")));
            }
            if let Err(e) = stdin.write_all(b"\n").await {
                self.pending.lock().await.remove(&id);
                return Err(exec(format!("write newline: {e}")));
            }
            if let Err(e) = stdin.flush().await {
                self.pending.lock().await.remove(&id);
                return Err(exec(format!("flush sidecar stdin: {e}")));
            }
        }

        let resp = match tokio::time::timeout(timeout, rx).await {
            Ok(Ok(r)) => r,
            Ok(Err(_)) => {
                return Err(exec("sidecar response channel dropped".into()));
            }
            Err(_) => {
                self.pending.lock().await.remove(&id);
                return Err(PrimitiveError::Timeout);
            }
        };

        if resp.ok {
            Ok(resp.result.unwrap_or(serde_json::Value::Null))
        } else {
            let err = resp.error.unwrap_or(RpcError {
                code: "unknown".into(),
                message: "sidecar returned ok=false with no error".into(),
            });
            Err(rpc_to_primitive(err))
        }
    }

    /// Best-effort graceful shutdown.
    pub async fn shutdown(&self) {
        // Send shutdown RPC, ignore result.
        let _ = self
            .request("shutdown", serde_json::json!({}), Duration::from_secs(3))
            .await;
        // Then make sure the child is gone.
        let mut child = self.child.lock().await;
        let _ = child.start_kill();
        let _ = tokio::time::timeout(Duration::from_secs(3), child.wait()).await;
    }

    pub fn is_alive(&self) -> bool {
        !self.dead.load(Ordering::SeqCst)
    }
}

impl Drop for SidecarProcess {
    fn drop(&mut self) {
        // tokio::process::Child has kill_on_drop(true) so the process dies
        // even if the runtime never gets to call shutdown.
        self.dead.store(true, Ordering::SeqCst);
    }
}

fn spawn_stderr_pump(stderr: tokio::process::ChildStderr) {
    tokio::spawn(async move {
        let mut reader = BufReader::new(stderr);
        let mut line = String::new();
        loop {
            line.clear();
            match reader.read_line(&mut line).await {
                Ok(0) => break,
                Ok(_) => {
                    let trimmed = line.trim_end();
                    if !trimmed.is_empty() {
                        tracing::info!(target: "playwright_sidecar", "{}", trimmed);
                    }
                }
                Err(_) => break,
            }
        }
    });
}

/// Like `BufReader::read_line` but caps the number of bytes read.
async fn read_capped_line<R: AsyncBufReadExt + Unpin>(
    reader: &mut R,
    buf: &mut String,
    cap: usize,
) -> std::io::Result<usize> {
    let start = buf.len();
    loop {
        let (consumed, done) = {
            let available = reader.fill_buf().await?;
            if available.is_empty() {
                return Ok(buf.len() - start);
            }
            if let Some(idx) = available.iter().position(|b| *b == b'\n') {
                let take = &available[..=idx];
                buf.push_str(std::str::from_utf8(take).map_err(|e| {
                    std::io::Error::new(std::io::ErrorKind::InvalidData, e)
                })?);
                (idx + 1, true)
            } else {
                buf.push_str(std::str::from_utf8(available).map_err(|e| {
                    std::io::Error::new(std::io::ErrorKind::InvalidData, e)
                })?);
                (available.len(), false)
            }
        };
        reader.consume(consumed);
        if done {
            return Ok(buf.len() - start);
        }
        if buf.len() - start > cap {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "sidecar response exceeded line length cap",
            ));
        }
    }
}

fn rpc_to_primitive(err: RpcError) -> PrimitiveError {
    match err.code.as_str() {
        "timeout" => PrimitiveError::Timeout,
        "size_limit" => PrimitiveError::SizeLimitExceeded,
        "invalid_params" => PrimitiveError::InvalidParams(err.message),
        "not_found" => PrimitiveError::NotFound(err.message),
        _ => PrimitiveError::ExecutionFailed(format!("{}: {}", err.code, err.message)),
    }
}

fn exec(msg: String) -> PrimitiveError {
    PrimitiveError::ExecutionFailed(msg)
}
