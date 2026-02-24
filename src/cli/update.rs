use anyhow::{Context, Result, bail};
use console::style;
use flate2::read::GzDecoder;
use sha2::{Digest, Sha256};
use std::io::Read;

use crate::core::terminal::{print_info, print_step, print_success};
use crate::platform::{NativePlatform, Platform};

const GITHUB_REPO: &str = "moxxy-ai/moxxy";
const CURRENT_VERSION: &str = env!("CARGO_PKG_VERSION");

fn detect_platform() -> Result<&'static str> {
    NativePlatform::update_platform().ok_or_else(|| {
        anyhow::anyhow!(
            "Unsupported platform: {}-{}",
            std::env::consts::OS,
            std::env::consts::ARCH
        )
    })
}

pub async fn run_update() -> Result<()> {
    let platform = detect_platform()?;

    print_step(&format!(
        "Current version: {} ({})",
        style(CURRENT_VERSION).cyan(),
        platform
    ));

    // Fetch latest release from GitHub API
    print_step("Checking for updates...");

    let client = reqwest::Client::builder()
        .user_agent("moxxy-updater")
        .build()?;

    let release: serde_json::Value = client
        .get(format!(
            "https://api.github.com/repos/{GITHUB_REPO}/releases/latest"
        ))
        .send()
        .await
        .context("Failed to reach GitHub API")?
        .error_for_status()
        .context("GitHub API returned an error")?
        .json()
        .await?;

    let tag = release["tag_name"]
        .as_str()
        .context("Missing tag_name in release")?;
    let latest_version = tag.strip_prefix('v').unwrap_or(tag);

    let current = semver::Version::parse(CURRENT_VERSION)?;
    let latest = semver::Version::parse(latest_version)?;

    if current >= latest {
        print_success(&format!("Already up to date! (v{})", CURRENT_VERSION));
        return Ok(());
    }

    print_info(&format!(
        "New version available: {} → {}",
        style(CURRENT_VERSION).red(),
        style(latest_version).green()
    ));

    // Find the platform-specific asset
    let asset_name = format!("moxxy-{tag}-{platform}.tar.gz");
    let assets = release["assets"]
        .as_array()
        .context("Missing assets in release")?;

    let asset = assets
        .iter()
        .find(|a| a["name"].as_str() == Some(&asset_name))
        .context(format!("No release artifact found for {platform}"))?;

    let download_url = asset["browser_download_url"]
        .as_str()
        .context("Missing download URL")?;

    // Download the binary archive
    print_step(&format!("Downloading {}...", style(&asset_name).dim()));

    let archive_bytes = client
        .get(download_url)
        .send()
        .await
        .context("Failed to download release")?
        .error_for_status()?
        .bytes()
        .await?;

    // Verify checksum
    print_step("Verifying checksum...");

    let checksums_asset = assets
        .iter()
        .find(|a| a["name"].as_str() == Some("checksums-sha256.txt"));

    if let Some(checksums_asset) = checksums_asset {
        let checksums_url = checksums_asset["browser_download_url"]
            .as_str()
            .context("Missing checksums download URL")?;

        let checksums_text = client
            .get(checksums_url)
            .send()
            .await?
            .error_for_status()?
            .text()
            .await?;

        let mut hasher = Sha256::new();
        hasher.update(&archive_bytes);
        let computed = hex::encode(hasher.finalize());

        let expected = checksums_text
            .lines()
            .find(|line| line.contains(&asset_name))
            .and_then(|line| line.split_whitespace().next())
            .context("Asset not found in checksums file")?;

        if computed != expected {
            bail!(
                "Checksum mismatch!\n  Expected: {}\n  Got:      {}",
                expected,
                computed
            );
        }
        print_step("Checksum verified.");
    } else {
        print_info("No checksums file found in release, skipping verification.");
    }

    // Extract binary from tar.gz
    print_step("Extracting...");

    let decoder = GzDecoder::new(&archive_bytes[..]);
    let mut archive = tar::Archive::new(decoder);

    let mut new_binary: Option<Vec<u8>> = None;
    for entry in archive.entries()? {
        let mut entry = entry?;
        let path = entry.path()?;
        if path.file_name().and_then(|n| n.to_str()) == Some(NativePlatform::binary_name()) {
            let mut buf = Vec::new();
            entry.read_to_end(&mut buf)?;
            new_binary = Some(buf);
            break;
        }
    }

    let new_binary = new_binary.context(format!(
        "Binary '{}' not found in archive",
        NativePlatform::binary_name()
    ))?;

    // Replace the current binary
    print_step("Installing...");

    let current_exe = std::env::current_exe().context("Cannot determine current binary path")?;
    let current_exe = current_exe.canonicalize().unwrap_or(current_exe);
    let backup_path = current_exe.with_extension("old");

    // Backup current binary
    std::fs::rename(&current_exe, &backup_path)
        .context("Failed to back up current binary. You may need to run with sudo.")?;

    // Write new binary
    if let Err(e) = std::fs::write(&current_exe, &new_binary) {
        // Restore backup on failure
        let _ = std::fs::rename(&backup_path, &current_exe);
        return Err(e).context("Failed to write new binary");
    }

    // Set executable permissions
    NativePlatform::set_executable(&current_exe);

    // Remove backup
    let _ = std::fs::remove_file(&backup_path);

    println!();
    print_success(&format!(
        "Updated moxxy: v{} → v{}",
        CURRENT_VERSION, latest_version
    ));
    print_info("Restart any running moxxy processes to use the new version.");

    Ok(())
}
