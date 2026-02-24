use anyhow::Result;

use crate::core::terminal::{
    self, GuideSection, print_error, print_info, print_step, print_success, print_warn,
};
use crate::platform::{NativePlatform, Platform};

/// Check and optionally install required dependencies.
/// Returns `true` if all critical dependencies are satisfied.
pub async fn ensure_dependencies() -> Result<bool> {
    print_step("Checking required dependencies...");
    println!("");

    let mut missing_rustup = false;
    let mut missing_wasm = false;

    // 1. Rustup Check
    match std::process::Command::new("rustup")
        .arg("--version")
        .output()
    {
        Ok(out) if out.status.success() => {
            print_success(&format!(
                "Rustup is installed: {}",
                String::from_utf8_lossy(&out.stdout).trim()
            ));
        }
        _ => {
            print_warn("Rustup is missing! (Required for WASM target management)");
            missing_rustup = true;
        }
    }

    // 2. Install Rustup if missing
    if missing_rustup {
        print_info("Attempting to install Rustup via the official installer...");
        let status = NativePlatform::install_rustup();

        match status {
            Ok(s) if s.success() => {
                print_success("Rustup installed successfully.");

                // Update PATH for the current process so subsequent checks work
                if let Some(home) = dirs::home_dir() {
                    let cargo_bin = home.join(".cargo").join("bin");
                    if cargo_bin.exists() {
                        let current_path = std::env::var_os("PATH").unwrap_or_default();
                        let mut paths = std::env::split_paths(&current_path).collect::<Vec<_>>();
                        paths.insert(0, cargo_bin.clone());
                        if let Ok(new_path) = std::env::join_paths(paths) {
                            unsafe {
                                std::env::set_var("PATH", new_path);
                            }
                            print_info(&format!(
                                "Prepend {} to PATH for this session.",
                                cargo_bin.display()
                            ));
                        }
                    }
                }

                missing_rustup = false;
            }
            _ => print_error("Failed to install Rustup automatically."),
        }
    }

    // 3. Cargo / Rust Check
    if !missing_rustup {
        match std::process::Command::new("cargo")
            .arg("--version")
            .output()
        {
            Ok(out) if out.status.success() => {
                print_success(&format!(
                    "Cargo (Rust) is available: {}",
                    String::from_utf8_lossy(&out.stdout).trim()
                ));
            }
            _ => {
                print_warn(NativePlatform::cargo_missing_hint());
            }
        }

        // 4. WASM Target Check
        let wasm_check = std::process::Command::new("rustup")
            .args(["target", "list", "--installed"])
            .output();
        match wasm_check {
            Ok(out) if out.status.success() => {
                let installed = String::from_utf8_lossy(&out.stdout);
                if installed.contains("wasm32-wasip1") {
                    print_success("WASM target (wasm32-wasip1) is installed.");
                } else {
                    print_warn("WASM target (wasm32-wasip1) is missing!");
                    missing_wasm = true;
                }
            }
            _ => {
                print_warn("Could not check WASM targets via rustup.");
                missing_wasm = true;
            }
        }

        // 5. Install WASM target if missing
        if missing_wasm {
            print_info("Attempting to install wasm32-wasip1 target...");
            let status = std::process::Command::new("rustup")
                .args(["target", "add", "wasm32-wasip1"])
                .status();
            match status {
                Ok(s) if s.success() => {
                    print_success("Successfully installed wasm32-wasip1 target.");
                    missing_wasm = false;
                }
                _ => print_error("Failed to install wasm32-wasip1 target automatically."),
            }
        }
    }

    // 6. SQLite3 Check
    match std::process::Command::new("sqlite3")
        .arg("--version")
        .output()
    {
        Ok(out) if out.status.success() => {
            print_success(&format!(
                "SQLite3 is available: {}",
                String::from_utf8_lossy(&out.stdout).trim()
            ));
        }
        _ => {
            print_warn("SQLite3 CLI is missing. (Recommended for debugging memory.db)");
        }
    }

    // 7. Git & Bash Check (bash ships with Git for Windows)
    check_and_install_git();

    // 8. OS-level Sandbox Check & Install
    check_and_install_sandbox().await;

    println!("");

    let all_ok = !missing_rustup && !missing_wasm;
    if !all_ok {
        print_error("Some critical dependencies are still missing. Please check the logs above.");
    }

    Ok(all_ok)
}

pub async fn run_doctor(fix: bool) -> Result<()> {
    terminal::print_banner();

    GuideSection::new("System Doctor")
        .text("Checking system dependencies and configuration...")
        .print();
    println!();

    let mut missing_rustup = false;
    let mut missing_wasm = false;

    // 1. Rustup Check
    match std::process::Command::new("rustup")
        .arg("--version")
        .output()
    {
        Ok(out) if out.status.success() => {
            print_success(&format!(
                "Rustup is installed: {}",
                String::from_utf8_lossy(&out.stdout).trim()
            ));
        }
        _ => {
            print_error("Rustup is missing! (Required for WASM target management)");
            missing_rustup = true;
        }
    }

    // 2. Fix Rustup if requested
    if missing_rustup && fix {
        print_info("Attempting to install Rustup via the official installer...");
        let status = NativePlatform::install_rustup();

        match status {
            Ok(s) if s.success() => {
                print_success("Rustup installed successfully.");

                // Update PATH for the current process so subsequent checks work
                if let Some(home) = dirs::home_dir() {
                    let cargo_bin = home.join(".cargo").join("bin");
                    if cargo_bin.exists() {
                        let current_path = std::env::var_os("PATH").unwrap_or_default();
                        let mut paths = std::env::split_paths(&current_path).collect::<Vec<_>>();
                        paths.insert(0, cargo_bin.clone());
                        if let Ok(new_path) = std::env::join_paths(paths) {
                            unsafe {
                                std::env::set_var("PATH", new_path);
                            }
                            print_info(&format!(
                                "Prepend {} to PATH for this session.",
                                cargo_bin.display()
                            ));
                        }
                    }
                }

                missing_rustup = false;
            }
            _ => print_error("Failed to install Rustup automatically."),
        }
    }

    // 3. Cargo / Rust Check
    if !missing_rustup {
        match std::process::Command::new("cargo")
            .arg("--version")
            .output()
        {
            Ok(out) if out.status.success() => {
                print_success(&format!(
                    "Cargo (Rust) is available: {}",
                    String::from_utf8_lossy(&out.stdout).trim()
                ));
            }
            _ => {
                print_warn(NativePlatform::cargo_missing_hint());
            }
        }

        // 4. WASM Target Check
        let wasm_check = std::process::Command::new("rustup")
            .args(["target", "list", "--installed"])
            .output();
        match wasm_check {
            Ok(out) if out.status.success() => {
                let installed = String::from_utf8_lossy(&out.stdout);
                if installed.contains("wasm32-wasip1") {
                    print_success("WASM target (wasm32-wasip1) is installed.");
                } else {
                    print_warn("WASM target (wasm32-wasip1) is missing!");
                    missing_wasm = true;
                }
            }
            _ => {
                print_warn("Could not check WASM targets via rustup.");
                missing_wasm = true;
            }
        }

        // 5. Fix WASM if requested
        if missing_wasm && fix {
            print_info("Attempting to install wasm32-wasip1 target...");
            let status = std::process::Command::new("rustup")
                .args(["target", "add", "wasm32-wasip1"])
                .status();
            match status {
                Ok(s) if s.success() => {
                    print_success("Successfully installed wasm32-wasip1 target.");
                    missing_wasm = false;
                }
                _ => print_error("Failed to install wasm32-wasip1 target automatically."),
            }
        }
    }

    // 6. SQLite3 Check
    match std::process::Command::new("sqlite3")
        .arg("--version")
        .output()
    {
        Ok(out) if out.status.success() => {
            print_success(&format!(
                "SQLite3 is available: {}",
                String::from_utf8_lossy(&out.stdout).trim()
            ));
        }
        _ => {
            print_warn("SQLite3 CLI is missing. (Recommended for debugging memory.db)");
        }
    }

    // 7. Git & Bash Check (bash ships with Git for Windows)
    check_and_install_git();

    // 8. OS-level Sandbox Check & Install
    if fix {
        check_and_install_sandbox().await;
    } else {
        check_sandbox_status();
    }

    if (missing_rustup || missing_wasm) && !fix {
        GuideSection::new("Result")
            .warn("Some dependencies are missing.")
            .blank()
            .info(&format!(
                "Run {} to auto-fix.",
                console::style("moxxy doctor --fix").cyan().bold()
            ))
            .print();
    } else if !missing_rustup && !missing_wasm {
        GuideSection::new("Result")
            .success("All systems normal. You are ready to fly!")
            .print();
    } else {
        GuideSection::new("Result")
            .warn("Some critical dependencies are still missing. Check the output above.")
            .print();
    }
    println!();

    Ok(())
}

/// Check that git (and bash) are available. On Windows, bash is bundled with Git for Windows.
/// Attempts automatic installation via winget on Windows if git is missing.
fn check_and_install_git() {
    // Git check
    let has_git = match std::process::Command::new("git").arg("--version").output() {
        Ok(out) if out.status.success() => {
            print_success(&format!(
                "Git is available: {}",
                String::from_utf8_lossy(&out.stdout).trim()
            ));
            true
        }
        _ => {
            print_warn("Git is missing!");
            false
        }
    };

    // Attempt to install git if missing
    if !has_git {
        if cfg!(windows) {
            print_info("Attempting to install Git for Windows via winget...");
            let status = std::process::Command::new("winget")
                .args([
                    "install",
                    "--id",
                    "Git.Git",
                    "-e",
                    "--accept-source-agreements",
                    "--accept-package-agreements",
                ])
                .status();
            match status {
                Ok(s) if s.success() => {
                    print_success(
                        "Git for Windows installed successfully. Please restart your terminal for PATH changes to take effect.",
                    );
                }
                _ => {
                    print_warn("Could not auto-install Git. Please install manually:");
                    print_info("  Download from https://gitforwindows.org");
                    print_info("  Or run: winget install --id Git.Git -e");
                }
            }
        } else if cfg!(target_os = "macos") {
            print_info("Install via: xcode-select --install  (or brew install git)");
        } else {
            print_info("Install via your package manager (e.g. sudo apt install git)");
        }
    }

    // Bash check (git ships bash on Windows)
    match std::process::Command::new("bash").arg("--version").output() {
        Ok(out) if out.status.success() => {
            let version = String::from_utf8_lossy(&out.stdout);
            let first_line = version.lines().next().unwrap_or("").trim();
            print_success(&format!("Bash is available: {}", first_line));
        }
        _ => {
            if cfg!(windows) {
                print_warn("Bash is missing! Skills require bash to run.");
                if has_git {
                    print_info(
                        "Git is installed but bash is not on PATH. Ensure Git for Windows bin directory is in your PATH.",
                    );
                } else {
                    print_info(
                        "Install Git for Windows (https://gitforwindows.org) which includes bash.",
                    );
                }
            } else {
                print_warn("Bash is not available. Some skills may not work.");
            }
        }
    }
}

/// Check sandbox availability without attempting installation.
fn check_sandbox_status() {
    #[cfg(target_os = "macos")]
    {
        if std::path::Path::new("/usr/bin/sandbox-exec").exists() {
            print_success("OS sandbox: sandbox-exec is available (macOS built-in).");
        } else {
            print_warn(
                "OS sandbox: sandbox-exec not found. Skill isolation will use environment restrictions only.",
            );
        }
    }

    #[cfg(target_os = "linux")]
    {
        match std::process::Command::new("which").arg("bwrap").output() {
            Ok(out) if out.status.success() => {
                print_success("OS sandbox: bubblewrap (bwrap) is available.");
            }
            _ => {
                print_warn(
                    "OS sandbox: bubblewrap (bwrap) is not installed. Skill isolation will use environment restrictions only.",
                );
                print_info(
                    "Install with: sudo apt install bubblewrap  (Debian/Ubuntu) or sudo dnf install bubblewrap  (Fedora)",
                );
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        print_warn(
            "OS sandbox: Windows does not support sandbox-exec or bwrap. Skill isolation uses environment restrictions and token-based access control.",
        );
    }
}

/// Check and attempt to install OS-level sandbox dependencies.
async fn check_and_install_sandbox() {
    #[cfg(target_os = "macos")]
    {
        // sandbox-exec is built into macOS, no installation needed
        if std::path::Path::new("/usr/bin/sandbox-exec").exists() {
            print_success("OS sandbox: sandbox-exec is available (macOS built-in).");
        } else {
            print_warn(
                "OS sandbox: sandbox-exec not found at /usr/bin/sandbox-exec. This is unexpected on macOS.",
            );
            print_info("Skill isolation will fall back to environment restrictions only.");
        }
    }

    #[cfg(target_os = "linux")]
    {
        let has_bwrap = std::process::Command::new("which")
            .arg("bwrap")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);

        if has_bwrap {
            print_success("OS sandbox: bubblewrap (bwrap) is available.");
        } else {
            print_warn("OS sandbox: bubblewrap (bwrap) is not installed.");
            print_info("Attempting to install bubblewrap for skill sandboxing...");

            // Try apt (Debian/Ubuntu)
            let installed =
                try_install_bwrap_apt() || try_install_bwrap_dnf() || try_install_bwrap_pacman();

            if installed {
                print_success("Successfully installed bubblewrap.");
            } else {
                print_warn("Could not auto-install bubblewrap. Please install manually:");
                print_info("  Debian/Ubuntu: sudo apt install bubblewrap");
                print_info("  Fedora/RHEL:   sudo dnf install bubblewrap");
                print_info("  Arch Linux:    sudo pacman -S bubblewrap");
                print_info("Skill isolation will fall back to environment restrictions only.");
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        print_warn("OS sandbox: Windows does not have sandbox-exec or bubblewrap equivalents.");
        print_info(
            "On Windows, skill isolation relies on environment restrictions and token-based access control.",
        );
        print_info(
            "Non-privileged skills cannot access the host proxy (no internal token) and run with a clean environment.",
        );
    }
}

#[cfg(target_os = "linux")]
fn try_install_bwrap_apt() -> bool {
    if std::process::Command::new("which")
        .arg("apt-get")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
    {
        print_info("Trying: sudo apt-get install -y bubblewrap");
        std::process::Command::new("sudo")
            .args(["apt-get", "install", "-y", "bubblewrap"])
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    } else {
        false
    }
}

#[cfg(target_os = "linux")]
fn try_install_bwrap_dnf() -> bool {
    if std::process::Command::new("which")
        .arg("dnf")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
    {
        print_info("Trying: sudo dnf install -y bubblewrap");
        std::process::Command::new("sudo")
            .args(["dnf", "install", "-y", "bubblewrap"])
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    } else {
        false
    }
}

#[cfg(target_os = "linux")]
fn try_install_bwrap_pacman() -> bool {
    if std::process::Command::new("which")
        .arg("pacman")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
    {
        print_info("Trying: sudo pacman -S --noconfirm bubblewrap");
        std::process::Command::new("sudo")
            .args(["pacman", "-S", "--noconfirm", "bubblewrap"])
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    } else {
        false
    }
}
