use anyhow::Result;

use crate::core::terminal::{self, print_error, print_info, print_success, print_warn, print_step};

pub async fn run_doctor(fix: bool) -> Result<()> {
    print_step("moxxy System Doctor - Checking Dependencies...");
    println!("");

    let mut missing_rustup = false;
    let mut missing_wasm = false;

    // 1. Rustup Check
    match std::process::Command::new("rustup").arg("--version").output() {
        Ok(out) if out.status.success() => {
            print_success(&format!("Rustup is installed: {}", String::from_utf8_lossy(&out.stdout).trim()));
        }
        _ => {
            print_error("Rustup is missing! (Required for WASM target management)");
            missing_rustup = true;
        }
    }

    // 2. Fix Rustup if requested
    if missing_rustup && fix {
        print_info("Attempting to install Rustup via the official installer...");
        let install_cmd = "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y";
        let status = std::process::Command::new("sh")
            .args(["-c", install_cmd])
            .status();

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
                            print_info(&format!("Prepend {} to PATH for this session.", cargo_bin.display()));
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
        match std::process::Command::new("cargo").arg("--version").output() {
            Ok(out) if out.status.success() => {
                print_success(&format!("Cargo (Rust) is available: {}", String::from_utf8_lossy(&out.stdout).trim()));
            }
            _ => {
                print_warn("Cargo not found in current PATH. You might need to run 'source $HOME/.cargo/env'.");
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
    match std::process::Command::new("sqlite3").arg("--version").output() {
        Ok(out) if out.status.success() => {
            print_success(&format!("SQLite3 is available: {}", String::from_utf8_lossy(&out.stdout).trim()));
        }
        _ => {
            print_warn("SQLite3 CLI is missing. (Recommended for debugging memory.db)");
        }
    }

    println!("");

    if (missing_rustup || missing_wasm) && !fix {
        print_info("To automatically install missing dependencies, run: moxxy doctor --fix");
    } else if !missing_rustup && !missing_wasm {
        println!("{} All systems normal. You are ready to fly!", terminal::ROCKET);
    } else {
        print_error("Some critical dependencies are still missing. Please check the logs above.");
    }

    Ok(())
}
