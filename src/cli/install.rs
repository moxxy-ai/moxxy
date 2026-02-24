use anyhow::Result;
use console::style;

use crate::core::terminal::{self, GuideSection, print_success};

/// Non-interactive first-run setup.
/// Creates the directory scaffold, initialises the database and vault.
/// Safe to call from a piped install script (`curl … | sh`).
pub async fn run_install() -> Result<()> {
    terminal::print_banner();

    GuideSection::new("Installation")
        .text("Setting up moxxy directory structure and initializing database...")
        .print();
    println!();

    use crate::platform::{NativePlatform, Platform};
    let moxxy_dir = NativePlatform::data_dir();
    let default_agent_dir = moxxy_dir.join("agents").join("default");
    let run_dir = moxxy_dir.join("run");

    // Create all required directories
    tokio::fs::create_dir_all(default_agent_dir.join("skills")).await?;
    tokio::fs::create_dir_all(default_agent_dir.join("workspace")).await?;
    tokio::fs::create_dir_all(&run_dir).await?;

    // Set restrictive permissions on directories
    NativePlatform::restrict_dir_permissions(&moxxy_dir);
    NativePlatform::restrict_dir_permissions(&default_agent_dir);

    // Initialise database and vault
    let memory_sys = crate::core::memory::MemorySystem::new(&default_agent_dir).await?;
    let vault = crate::core::vault::SecretsVault::new(memory_sys.get_db());
    vault.initialize().await?;

    // Check dependencies (non-interactive, just report)
    super::doctor::ensure_dependencies().await?;

    print_success("Installation complete!");

    GuideSection::new("Next Steps")
        .info(&format!(
            "Run {} to configure your AI provider and agent.",
            style("moxxy init").cyan().bold()
        ))
        .print();
    println!();

    Ok(())
}
