use anyhow::Result;
use console::style;

use crate::core::terminal::{self, print_success};

/// Non-interactive first-run setup.
/// Creates the directory scaffold, initialises the database and vault.
/// Safe to call from a piped install script (`curl … | sh`).
pub async fn run_install() -> Result<()> {
    terminal::print_banner();
    println!(
        "  {}\n",
        style("Setting up moxxy directory structure...").bold()
    );

    let home = dirs::home_dir().expect("Could not find home directory");
    let moxxy_dir = home.join(".moxxy");
    let default_agent_dir = moxxy_dir.join("agents").join("default");
    let run_dir = moxxy_dir.join("run");

    // Create all required directories
    tokio::fs::create_dir_all(default_agent_dir.join("skills")).await?;
    tokio::fs::create_dir_all(default_agent_dir.join("workspace")).await?;
    tokio::fs::create_dir_all(&run_dir).await?;

    // Set restrictive permissions on directories
    {
        use crate::platform::{NativePlatform, Platform};
        NativePlatform::restrict_dir_permissions(&moxxy_dir);
        NativePlatform::restrict_dir_permissions(&default_agent_dir);
    }

    // Initialise database and vault
    let memory_sys = crate::core::memory::MemorySystem::new(&default_agent_dir).await?;
    let vault = crate::core::vault::SecretsVault::new(memory_sys.get_db());
    vault.initialize().await?;

    // Check dependencies (non-interactive, just report)
    super::doctor::ensure_dependencies().await?;

    print_success("Installation complete!");
    println!(
        "\n  Run {} to configure your AI provider and agent.\n",
        style("moxxy init").cyan().bold()
    );

    Ok(())
}
