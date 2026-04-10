//! On-demand bootstrap for the Playwright sidecar.
//!
//! Steps (each idempotent):
//!   1. Locate a Node ≥ 18 binary, downloading the official tarball if needed.
//!   2. Materialize the bundled `sidecar.mjs` and `package.json` into the
//!      sidecar dir.
//!   3. `npm install` Playwright into the sidecar dir.
//!   4. `playwright install chromium` into a self-contained browsers dir.
//!   5. Write a marker file so subsequent boots short-circuit.
//!
//! All work runs serialized behind a single mutex inside `BrowserManager`,
//! so concurrent first calls coalesce and never race the install.

use std::path::{Path, PathBuf};
use std::time::Duration;

use sha2::{Digest, Sha256};
use tokio::io::AsyncWriteExt;
use tokio::process::Command;

use super::config::BrowserConfig;
use crate::registry::PrimitiveError;

/// Pinned Node LTS. Bumping this triggers a re-bootstrap (the marker file
/// embeds the version).
pub const NODE_VERSION: &str = "20.18.1";
/// Pinned playwright-core; must match `sidecars/playwright/package.json`.
pub const PLAYWRIGHT_VERSION: &str = "1.49.1";
/// Bumping this string forces every existing install to re-bootstrap.
pub const SIDECAR_ASSETS_VERSION: &str = "1";

const PACKAGE_JSON: &str = include_str!("../../sidecars/playwright/package.json");
const SIDECAR_MJS: &str = include_str!("../../sidecars/playwright/sidecar.mjs");

/// Fully bootstrapped install paths the manager needs to spawn the sidecar.
#[derive(Debug, Clone)]
pub struct InstalledSidecar {
    pub node_bin: PathBuf,
    pub sidecar_script: PathBuf,
    pub browsers_dir: PathBuf,
}

/// Run the full bootstrap if needed and return the install paths.
pub async fn ensure_installed(config: &BrowserConfig) -> Result<InstalledSidecar, PrimitiveError> {
    let marker = config.install_marker();
    let expected_marker = marker_contents();

    // Locate or install Node first; we need it for both subsequent steps.
    let node_bin = ensure_node(&config.runtimes_dir).await?;

    let sidecar_script = config.sidecar_dir.join("sidecar.mjs");
    let browsers_dir = config.browsers_dir();

    if marker.exists()
        && tokio::fs::read_to_string(&marker).await.ok().as_deref() == Some(expected_marker.as_str())
        && sidecar_script.exists()
    {
        tracing::debug!(marker = %marker.display(), "playwright sidecar already installed");
        return Ok(InstalledSidecar {
            node_bin,
            sidecar_script,
            browsers_dir,
        });
    }

    tracing::info!(
        sidecar_dir = %config.sidecar_dir.display(),
        "bootstrapping playwright sidecar (one-time, ~250 MB download)",
    );

    fs_create_dir_all(&config.sidecar_dir).await?;
    write_bundled_assets(&config.sidecar_dir).await?;
    npm_install(&node_bin, &config.sidecar_dir).await?;
    playwright_install_chromium(&node_bin, &config.sidecar_dir, &browsers_dir).await?;

    tokio::fs::write(&marker, expected_marker.as_bytes())
        .await
        .map_err(|e| exec(format!("write install marker: {e}")))?;

    tracing::info!("playwright sidecar bootstrap complete");
    Ok(InstalledSidecar {
        node_bin,
        sidecar_script,
        browsers_dir,
    })
}

fn marker_contents() -> String {
    format!(
        "node={NODE_VERSION}\nplaywright={PLAYWRIGHT_VERSION}\nassets={SIDECAR_ASSETS_VERSION}\n"
    )
}

async fn write_bundled_assets(sidecar_dir: &Path) -> Result<(), PrimitiveError> {
    tokio::fs::write(sidecar_dir.join("package.json"), PACKAGE_JSON)
        .await
        .map_err(|e| exec(format!("write package.json: {e}")))?;
    tokio::fs::write(sidecar_dir.join("sidecar.mjs"), SIDECAR_MJS)
        .await
        .map_err(|e| exec(format!("write sidecar.mjs: {e}")))?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Node detection / download
// ---------------------------------------------------------------------------

/// Find Node ≥ 18: env var → PATH → managed dir → download.
pub async fn ensure_node(runtimes_dir: &Path) -> Result<PathBuf, PrimitiveError> {
    if let Some(p) = check_node_env().await {
        return Ok(p);
    }
    if let Some(p) = check_node_path().await {
        return Ok(p);
    }
    let managed = managed_node_bin(runtimes_dir);
    if check_node_at(&managed).await.is_some() {
        return Ok(managed);
    }
    download_node(runtimes_dir).await
}

async fn check_node_env() -> Option<PathBuf> {
    let raw = std::env::var("NODE_PATH").ok()?;
    let p = PathBuf::from(raw);
    check_node_at(&p).await
}

async fn check_node_path() -> Option<PathBuf> {
    let p = PathBuf::from("node");
    let out = Command::new(&p).arg("--version").output().await.ok()?;
    if out.status.success() && parse_node_version(&out.stdout).map(|v| v.0 >= 18).unwrap_or(false) {
        Some(p)
    } else {
        None
    }
}

async fn check_node_at(path: &Path) -> Option<PathBuf> {
    if !path.exists() {
        return None;
    }
    let out = Command::new(path).arg("--version").output().await.ok()?;
    if out.status.success() && parse_node_version(&out.stdout).map(|v| v.0 >= 18).unwrap_or(false) {
        Some(path.to_path_buf())
    } else {
        None
    }
}

fn parse_node_version(stdout: &[u8]) -> Option<(u32, u32, u32)> {
    let s = std::str::from_utf8(stdout).ok()?.trim();
    let s = s.strip_prefix('v').unwrap_or(s);
    let mut parts = s.split('.');
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next().unwrap_or("0").parse().ok()?;
    let patch = parts.next().unwrap_or("0").parse().ok()?;
    Some((major, minor, patch))
}

fn managed_node_root(runtimes_dir: &Path) -> PathBuf {
    runtimes_dir.join("node").join(node_platform_dir())
}

fn managed_node_bin(runtimes_dir: &Path) -> PathBuf {
    managed_node_root(runtimes_dir).join("bin").join("node")
}

fn node_platform_dir() -> String {
    let os = if cfg!(target_os = "macos") {
        "darwin"
    } else if cfg!(target_os = "linux") {
        "linux"
    } else {
        "unsupported"
    };
    let arch = if cfg!(target_arch = "aarch64") {
        "arm64"
    } else if cfg!(target_arch = "x86_64") {
        "x64"
    } else {
        "unsupported"
    };
    format!("node-v{NODE_VERSION}-{os}-{arch}")
}

async fn download_node(runtimes_dir: &Path) -> Result<PathBuf, PrimitiveError> {
    let dir_name = node_platform_dir();
    if dir_name.contains("unsupported") {
        return Err(exec(
            "auto-download of Node is only supported on macOS/Linux x64/arm64. \
             Install Node ≥ 18 manually and put it on PATH or set NODE_PATH."
                .to_string(),
        ));
    }
    let tarball_name = format!("{dir_name}.tar.gz");
    let url = format!("https://nodejs.org/dist/v{NODE_VERSION}/{tarball_name}");
    let shasums_url = format!("https://nodejs.org/dist/v{NODE_VERSION}/SHASUMS256.txt");

    tracing::info!(%url, "downloading Node");

    let node_root_parent = runtimes_dir.join("node");
    fs_create_dir_all(&node_root_parent).await?;

    let tmp_tarball = node_root_parent.join(format!("{tarball_name}.partial"));
    fetch_to_file(&url, &tmp_tarball).await?;

    // Verify SHA256.
    let shasums = fetch_text(&shasums_url).await?;
    let expected = shasums
        .lines()
        .find_map(|line| {
            let mut it = line.split_whitespace();
            let hash = it.next()?;
            let name = it.next()?;
            if name == tarball_name {
                Some(hash.to_string())
            } else {
                None
            }
        })
        .ok_or_else(|| exec(format!("could not find {tarball_name} in SHASUMS256.txt")))?;

    let actual = sha256_file(&tmp_tarball).await?;
    if actual != expected {
        let _ = tokio::fs::remove_file(&tmp_tarball).await;
        return Err(exec(format!(
            "Node tarball SHA256 mismatch: expected {expected}, got {actual}"
        )));
    }
    tracing::info!("Node tarball verified");

    // Extract.
    let final_root = managed_node_root(runtimes_dir);
    let staging = node_root_parent.join(format!("{dir_name}.partial-extract"));
    if staging.exists() {
        let _ = tokio::fs::remove_dir_all(&staging).await;
    }
    fs_create_dir_all(&staging).await?;
    extract_tar_gz(&tmp_tarball, &staging).await?;

    // Node tarball extracts to `<dir_name>/...`. Move that subdir into place.
    let inner = staging.join(&dir_name);
    if !inner.exists() {
        return Err(exec(format!(
            "extracted tarball missing expected dir {}",
            inner.display()
        )));
    }
    if final_root.exists() {
        let _ = tokio::fs::remove_dir_all(&final_root).await;
    }
    fs_create_dir_all(final_root.parent().unwrap()).await?;
    tokio::fs::rename(&inner, &final_root)
        .await
        .map_err(|e| exec(format!("rename node dir: {e}")))?;

    // Cleanup.
    let _ = tokio::fs::remove_file(&tmp_tarball).await;
    let _ = tokio::fs::remove_dir_all(&staging).await;

    let node_bin = managed_node_bin(runtimes_dir);
    if !node_bin.exists() {
        return Err(exec(format!(
            "Node install completed but {} is missing",
            node_bin.display()
        )));
    }
    tracing::info!(node_bin = %node_bin.display(), "Node installed");
    Ok(node_bin)
}

async fn fetch_to_file(url: &str, dest: &Path) -> Result<(), PrimitiveError> {
    use futures_util::StreamExt;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(600))
        .build()
        .map_err(|e| exec(format!("http client: {e}")))?;
    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| exec(format!("download {url}: {e}")))?;
    if !resp.status().is_success() {
        return Err(exec(format!("download {url}: HTTP {}", resp.status())));
    }
    if let Some(parent) = dest.parent() {
        fs_create_dir_all(parent).await?;
    }
    let mut file = tokio::fs::File::create(dest)
        .await
        .map_err(|e| exec(format!("create {}: {e}", dest.display())))?;
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| exec(format!("read {url}: {e}")))?;
        file.write_all(&chunk)
            .await
            .map_err(|e| exec(format!("write {}: {e}", dest.display())))?;
    }
    file.flush()
        .await
        .map_err(|e| exec(format!("flush {}: {e}", dest.display())))?;
    Ok(())
}

async fn fetch_text(url: &str) -> Result<String, PrimitiveError> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| exec(format!("http client: {e}")))?;
    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| exec(format!("download {url}: {e}")))?;
    if !resp.status().is_success() {
        return Err(exec(format!("download {url}: HTTP {}", resp.status())));
    }
    resp.text()
        .await
        .map_err(|e| exec(format!("read {url}: {e}")))
}

async fn sha256_file(path: &Path) -> Result<String, PrimitiveError> {
    let path = path.to_path_buf();
    tokio::task::spawn_blocking(move || -> Result<String, PrimitiveError> {
        use std::io::Read;
        let mut file = std::fs::File::open(&path)
            .map_err(|e| exec(format!("open {}: {e}", path.display())))?;
        let mut hasher = Sha256::new();
        let mut buf = [0u8; 64 * 1024];
        loop {
            let n = file
                .read(&mut buf)
                .map_err(|e| exec(format!("read {}: {e}", path.display())))?;
            if n == 0 {
                break;
            }
            hasher.update(&buf[..n]);
        }
        Ok(hex::encode(hasher.finalize()))
    })
    .await
    .map_err(|e| exec(format!("sha256 join: {e}")))?
}

async fn extract_tar_gz(tarball: &Path, dest: &Path) -> Result<(), PrimitiveError> {
    let tarball = tarball.to_path_buf();
    let dest = dest.to_path_buf();
    tokio::task::spawn_blocking(move || -> Result<(), PrimitiveError> {
        let file = std::fs::File::open(&tarball)
            .map_err(|e| exec(format!("open {}: {e}", tarball.display())))?;
        let gz = flate2::read::GzDecoder::new(file);
        let mut archive = tar::Archive::new(gz);
        archive.set_preserve_permissions(true);
        archive
            .unpack(&dest)
            .map_err(|e| exec(format!("untar to {}: {e}", dest.display())))?;
        Ok(())
    })
    .await
    .map_err(|e| exec(format!("extract join: {e}")))?
}

// ---------------------------------------------------------------------------
// npm install / playwright install
// ---------------------------------------------------------------------------

async fn npm_install(node_bin: &Path, sidecar_dir: &Path) -> Result<(), PrimitiveError> {
    let npm_cli = npm_cli_for(node_bin)?;
    tracing::info!(
        sidecar_dir = %sidecar_dir.display(),
        "running npm install (playwright-core)",
    );
    let status = Command::new(node_bin)
        .arg(&npm_cli)
        .arg("install")
        .arg("--omit=dev")
        .arg("--no-audit")
        .arg("--no-fund")
        .arg("--no-progress")
        .arg("--loglevel=error")
        .current_dir(sidecar_dir)
        .env("NPM_CONFIG_UPDATE_NOTIFIER", "false")
        .status()
        .await
        .map_err(|e| exec(format!("spawn npm: {e}")))?;
    if !status.success() {
        return Err(exec(format!("npm install failed with {status}")));
    }
    Ok(())
}

/// Locate `npm-cli.js` relative to a Node binary.
fn npm_cli_for(node_bin: &Path) -> Result<PathBuf, PrimitiveError> {
    // For tarball Node: <root>/lib/node_modules/npm/bin/npm-cli.js
    // For Homebrew Node: same.
    let root = node_bin
        .parent() // bin/
        .and_then(|p| p.parent()) // <root>
        .ok_or_else(|| exec(format!("cannot derive node root from {}", node_bin.display())))?;
    let candidate = root
        .join("lib")
        .join("node_modules")
        .join("npm")
        .join("bin")
        .join("npm-cli.js");
    if candidate.exists() {
        return Ok(candidate);
    }
    // Some packagings put npm under share/.
    let alt = root
        .join("share")
        .join("npm")
        .join("bin")
        .join("npm-cli.js");
    if alt.exists() {
        return Ok(alt);
    }
    Err(exec(format!(
        "could not locate npm-cli.js relative to {}",
        node_bin.display()
    )))
}

async fn playwright_install_chromium(
    node_bin: &Path,
    sidecar_dir: &Path,
    browsers_dir: &Path,
) -> Result<(), PrimitiveError> {
    let cli = sidecar_dir
        .join("node_modules")
        .join("playwright-core")
        .join("cli.js");
    if !cli.exists() {
        return Err(exec(format!(
            "playwright-core cli.js missing at {} — npm install likely failed",
            cli.display()
        )));
    }
    fs_create_dir_all(browsers_dir).await?;
    tracing::info!(
        browsers_dir = %browsers_dir.display(),
        "downloading Chromium for Playwright (~170 MB)",
    );
    let status = Command::new(node_bin)
        .arg(&cli)
        .arg("install")
        .arg("chromium")
        .current_dir(sidecar_dir)
        .env("PLAYWRIGHT_BROWSERS_PATH", browsers_dir)
        .status()
        .await
        .map_err(|e| exec(format!("spawn playwright cli: {e}")))?;
    if !status.success() {
        return Err(exec(format!("playwright install chromium failed: {status}")));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// utils
// ---------------------------------------------------------------------------

async fn fs_create_dir_all(path: &Path) -> Result<(), PrimitiveError> {
    tokio::fs::create_dir_all(path)
        .await
        .map_err(|e| exec(format!("mkdir -p {}: {e}", path.display())))
}

fn exec(msg: String) -> PrimitiveError {
    PrimitiveError::ExecutionFailed(msg)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_node_version() {
        assert_eq!(parse_node_version(b"v20.18.1\n"), Some((20, 18, 1)));
        assert_eq!(parse_node_version(b"v18.0.0"), Some((18, 0, 0)));
        assert_eq!(parse_node_version(b"junk"), None);
    }

    #[test]
    fn marker_contents_includes_versions() {
        let m = marker_contents();
        assert!(m.contains(NODE_VERSION));
        assert!(m.contains(PLAYWRIGHT_VERSION));
    }

    #[test]
    fn node_platform_dir_is_well_formed() {
        let d = node_platform_dir();
        assert!(d.starts_with(&format!("node-v{NODE_VERSION}")));
    }
}
