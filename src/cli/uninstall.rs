use anyhow::{Context, Result, bail};
use console::style;
use std::io::{self, Write};

use crate::core::terminal::{GuideSection, close_section, guide_bar, print_step, print_warn};
use crate::platform::{NativePlatform, Platform};

pub async fn run_uninstall() -> Result<()> {
    GuideSection::new("Uninstall moxxy")
        .warn("This will completely remove moxxy from your system:")
        .blank()
        .bullet("The moxxy binary")
        .bullet("All agent data (~/.moxxy directory)")
        .open();

    print!("{} ", style("Continue? [y/N]").yellow().bold());
    io::stdout().flush()?;

    let mut input = String::new();
    io::stdin().read_line(&mut input)?;
    let input = input.trim().to_lowercase();
    guide_bar();
    close_section();

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

    let binary_path = NativePlatform::installed_binary_path();

    if binary_path.exists() {
        print_step(&format!("Removing binary: {}", binary_path.display()));
        if let Err(e) = std::fs::remove_file(&binary_path) {
            bail!(
                "Failed to remove binary '{}': {}\nYou may need to run with sudo.",
                binary_path.display(),
                e
            );
        }
    } else {
        print_warn(&format!(
            "Binary not found at {} (already removed?)",
            binary_path.display()
        ));
    }

    GuideSection::new("Uninstall Complete")
        .success("moxxy has been uninstalled.")
        .print();
    println!();

    Ok(())
}
