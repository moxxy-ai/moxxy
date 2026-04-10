use moxxy_core::NetworkMode;
use std::path::PathBuf;
use std::time::Duration;

/// Configuration for a per-agent `BrowserManager`.
#[derive(Debug, Clone)]
pub struct BrowserConfig {
    /// Root for downloaded Node runtimes (`~/.moxxy/runtimes`).
    pub runtimes_dir: PathBuf,
    /// Root for the sidecar install (`~/.moxxy/sidecars/playwright`).
    pub sidecar_dir: PathBuf,
    /// Per-agent allowlist file used by `browser.navigate` for domain checks.
    pub allowlist_path: PathBuf,
    pub network_mode: NetworkMode,

    /// Default per-call timeout if the agent doesn't supply one.
    pub default_timeout: Duration,
    /// Hard cap on per-call timeout (defense against runaway requests).
    pub max_timeout: Duration,
    /// Time the sidecar may be idle before we kill it.
    pub idle_timeout: Duration,

    /// Hard cap on HTML/text payloads returned by `browser.read`.
    pub max_html_bytes: usize,
    /// Hard cap on screenshot bytes returned in-band (base64).
    pub max_screenshot_bytes: usize,
}

impl BrowserConfig {
    pub fn new(moxxy_home: PathBuf, allowlist_path: PathBuf, network_mode: NetworkMode) -> Self {
        let runtimes_dir = moxxy_home.join("runtimes");
        let sidecar_dir = moxxy_home.join("sidecars").join("playwright");
        Self {
            runtimes_dir,
            sidecar_dir,
            allowlist_path,
            network_mode,
            default_timeout: Duration::from_secs(30),
            max_timeout: Duration::from_secs(120),
            idle_timeout: Duration::from_secs(300),
            max_html_bytes: 4 * 1024 * 1024,
            max_screenshot_bytes: 8 * 1024 * 1024,
        }
    }

    /// Where Playwright should cache its browser binaries.
    pub fn browsers_dir(&self) -> PathBuf {
        self.sidecar_dir.join("browsers")
    }

    /// Marker file written after a successful bootstrap.
    pub fn install_marker(&self) -> PathBuf {
        self.sidecar_dir.join(".installed-v1")
    }
}
