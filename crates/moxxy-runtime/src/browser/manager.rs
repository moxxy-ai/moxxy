//! Per-agent supervised browser sidecar.
//!
//! `BrowserManager` is the only object the `browser.*` primitives talk to.
//! Internally it owns:
//!   - the `BrowserConfig` (paths, caps, allowlist),
//!   - a `Mutex<Option<Arc<SidecarProcess>>>` holding the live sidecar (or
//!     `None` when stopped),
//!   - a last-activity instant for idle timeout enforcement.
//!
//! On every `request()` the manager:
//!   1. Lazily bootstraps Node + Playwright + Chromium (first call only).
//!   2. Starts the sidecar if it's not running, or has died, or has been
//!      idle-killed.
//!   3. Forwards the JSON-RPC request, updating last-activity on success.
//!   4. Maps RPC errors to `PrimitiveError`.

use std::sync::Arc;
use std::time::{Duration, Instant};

use tokio::sync::Mutex;

use super::bootstrap::{InstalledSidecar, ensure_installed};
use super::config::BrowserConfig;
use super::sidecar::SidecarProcess;
use crate::registry::PrimitiveError;

pub struct BrowserManager {
    config: BrowserConfig,
    state: Mutex<State>,
}

struct State {
    install: Option<InstalledSidecar>,
    sidecar: Option<Arc<SidecarProcess>>,
    last_active: Instant,
}

impl BrowserManager {
    pub fn new(config: BrowserConfig) -> Arc<Self> {
        let mgr = Arc::new(Self {
            config,
            state: Mutex::new(State {
                install: None,
                sidecar: None,
                last_active: Instant::now(),
            }),
        });
        Self::spawn_idle_watcher(mgr.clone());
        mgr
    }

    pub fn config(&self) -> &BrowserConfig {
        &self.config
    }

    /// Ensure the sidecar is bootstrapped + running, then forward a JSON-RPC
    /// request and return the result. `timeout` is the per-call ceiling.
    pub async fn request(
        &self,
        method: &str,
        params: serde_json::Value,
        timeout: Option<Duration>,
    ) -> Result<serde_json::Value, PrimitiveError> {
        let timeout = self.clamp_timeout(timeout);
        let sidecar = self.get_or_spawn().await?;
        let result = sidecar.request(method, params, timeout).await;
        // Update activity on success or any error other than transport death.
        // (We treat the call as "activity" — even an error keeps the sidecar
        // warm because the agent is actively using it.)
        let mut st = self.state.lock().await;
        st.last_active = Instant::now();
        // If the sidecar reports it died mid-call, drop our reference so the
        // next call respawns.
        if !sidecar.is_alive() {
            st.sidecar = None;
        }
        drop(st);
        result
    }

    /// Best-effort graceful shutdown.
    pub async fn shutdown(&self) {
        let mut st = self.state.lock().await;
        if let Some(sc) = st.sidecar.take() {
            drop(st);
            sc.shutdown().await;
        }
    }

    fn clamp_timeout(&self, requested: Option<Duration>) -> Duration {
        let want = requested.unwrap_or(self.config.default_timeout);
        let min = Duration::from_secs(1);
        let max = self.config.max_timeout;
        want.clamp(min, max)
    }

    async fn get_or_spawn(&self) -> Result<Arc<SidecarProcess>, PrimitiveError> {
        // Fast path: already running.
        {
            let st = self.state.lock().await;
            if let Some(sc) = &st.sidecar {
                if sc.is_alive() {
                    return Ok(sc.clone());
                }
            }
        }

        // Slow path: bootstrap + spawn under the lock so concurrent first
        // callers coalesce.
        let mut st = self.state.lock().await;
        if let Some(sc) = &st.sidecar {
            if sc.is_alive() {
                return Ok(sc.clone());
            }
        }

        let install = match &st.install {
            Some(i) => i.clone(),
            None => {
                drop(st);
                let installed = ensure_installed(&self.config).await?;
                st = self.state.lock().await;
                st.install = Some(installed.clone());
                installed
            }
        };

        let sidecar = Arc::new(SidecarProcess::spawn(&install).await?);
        st.sidecar = Some(sidecar.clone());
        st.last_active = Instant::now();
        Ok(sidecar)
    }

    fn spawn_idle_watcher(mgr: Arc<Self>) {
        tokio::spawn(async move {
            let check_interval = Duration::from_secs(30);
            loop {
                tokio::time::sleep(check_interval).await;
                // Bail out if the manager has been dropped (no other Arc).
                if Arc::strong_count(&mgr) <= 1 {
                    return;
                }
                let idle_timeout = mgr.config.idle_timeout;
                let mut st = mgr.state.lock().await;
                let idle_for = st.last_active.elapsed();
                if let Some(sc) = &st.sidecar {
                    if sc.is_alive() && idle_for >= idle_timeout {
                        tracing::info!(idle_secs = idle_for.as_secs(), "idle-killing browser sidecar");
                        let to_close = st.sidecar.take();
                        drop(st);
                        if let Some(sc) = to_close {
                            sc.shutdown().await;
                        }
                        continue;
                    }
                    if !sc.is_alive() {
                        st.sidecar = None;
                    }
                }
            }
        });
    }
}

impl Drop for BrowserManager {
    fn drop(&mut self) {
        // We can't await here, but kill_on_drop on the child handles it.
        if let Ok(mut st) = self.state.try_lock() {
            st.sidecar = None;
        }
    }
}
