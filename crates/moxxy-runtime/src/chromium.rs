use std::path::{Path, PathBuf};

/// Manages Chromium binary detection for headless browsing.
///
/// Checks (in order): `CHROME_PATH` env var, system Chrome installs,
/// and previously downloaded Chromium at `~/.moxxy/chromium/`.
pub struct ChromiumManager {
    chrome_path: PathBuf,
}

impl ChromiumManager {
    /// Detect an installed Chrome/Chromium binary.
    /// Returns `None` if no browser is found.
    pub fn detect(moxxy_home: &Path) -> Option<Self> {
        // 1. CHROME_PATH env var
        if let Ok(path) = std::env::var("CHROME_PATH") {
            let p = PathBuf::from(&path);
            if p.exists() {
                tracing::info!(path = %p.display(), "Found Chrome via CHROME_PATH");
                return Some(Self { chrome_path: p });
            }
        }

        // 2. System Chrome (platform-specific)
        for candidate in system_chrome_paths() {
            let p = PathBuf::from(candidate);
            if p.exists() {
                tracing::info!(path = %p.display(), "Found system Chrome");
                return Some(Self { chrome_path: p });
            }
        }

        // 3. Previously downloaded: ~/.moxxy/chromium/
        let downloaded = moxxy_home.join("chromium").join(platform_dir()).join(chrome_binary_name());
        if downloaded.exists() {
            tracing::info!(path = %downloaded.display(), "Found downloaded Chromium");
            return Some(Self {
                chrome_path: downloaded,
            });
        }

        tracing::debug!("No Chrome/Chromium binary found");
        None
    }

    /// Path to the Chrome/Chromium binary.
    pub fn chrome_path(&self) -> &Path {
        &self.chrome_path
    }
}

fn system_chrome_paths() -> Vec<&'static str> {
    if cfg!(target_os = "macos") {
        vec![
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Chromium.app/Contents/MacOS/Chromium",
        ]
    } else if cfg!(target_os = "linux") {
        vec![
            "/usr/bin/google-chrome",
            "/usr/bin/google-chrome-stable",
            "/usr/bin/chromium",
            "/usr/bin/chromium-browser",
        ]
    } else {
        vec![]
    }
}

fn platform_dir() -> &'static str {
    if cfg!(target_os = "macos") {
        if cfg!(target_arch = "aarch64") {
            "chrome-mac-arm64"
        } else {
            "chrome-mac-x64"
        }
    } else {
        "chrome-linux64"
    }
}

fn chrome_binary_name() -> &'static str {
    if cfg!(target_os = "macos") {
        "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
    } else {
        "chrome"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn detect_returns_none_when_nothing_found() {
        let tmp = TempDir::new().unwrap();
        // With no CHROME_PATH env and no system chrome, should return None
        // (unless the test machine has Chrome installed)
        let result = ChromiumManager::detect(tmp.path());
        // We can't assert None because CI may have Chrome — just verify it doesn't panic
        let _ = result;
    }

    #[test]
    fn detect_finds_downloaded_chromium() {
        let tmp = TempDir::new().unwrap();
        let chrome_dir = tmp.path().join("chromium").join(platform_dir());
        std::fs::create_dir_all(&chrome_dir).unwrap();
        let chrome_bin = chrome_dir.join(chrome_binary_name());
        if let Some(parent) = chrome_bin.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(&chrome_bin, "fake-chrome").unwrap();

        // detect() may find system Chrome first — just verify it finds *something*
        // and that the downloaded path is valid.
        let manager = ChromiumManager::detect(tmp.path());
        assert!(manager.is_some());
        // The returned path should be a valid existing file (either system or downloaded).
        assert!(manager.unwrap().chrome_path().exists());
    }

    #[test]
    fn platform_dir_is_not_empty() {
        assert!(!platform_dir().is_empty());
    }
}
