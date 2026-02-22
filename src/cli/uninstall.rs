use anyhow::{Context, Result, bail};
use console::style;
use std::io::{self, Write};

use crate::core::terminal::{print_step, print_success, print_warn};

pub async fn run_uninstall() -> Result<()> {
    println!();
    print_warn("This will completely remove moxxy from your system:");
    println!("  • The moxxy binary");
    println!("  • All agent data (~/.moxxy directory)");
    println!();

    print!("{} ", style("Continue? [y/N]").yellow().bold());
    io::stdout().flush()?;

    let mut input = String::new();
    io::stdin().read_line(&mut input)?;
    let input = input.trim().to_lowercase();

    if input != "y" && input != "yes" {
        println!("{}", style("Uninstall cancelled.").dim());
        return Ok(());
    }

    let home = dirs::home_dir().context("Could not find home directory")?;
    let moxxy_dir = home.join(".moxxy");

    if moxxy_dir.exists() {
        print_step("Removing ~/.moxxy directory...");
        std::fs::remove_dir_all(&moxxy_dir).context("Failed to remove ~/.moxxy directory")?;
    }

    let current_exe = std::env::current_exe().context("Cannot determine current binary path")?;
    let current_exe = current_exe.canonicalize().unwrap_or(current_exe);

    print_step(&format!("Removing binary: {}", current_exe.display()));

    if let Err(e) = std::fs::remove_file(&current_exe) {
        bail!(
            "Failed to remove binary '{}': {}\nYou may need to run with sudo.",
            current_exe.display(),
            e
        );
    }

    println!();
    print_success("moxxy has been uninstalled.");
    println!();

    Ok(())
}
