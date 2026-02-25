use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};

use super::{Platform, resolve_data_dir};

pub struct NativePlatform;

impl Platform for NativePlatform {
    fn default_shell() -> &'static str {
        "sh"
    }

    fn shell_command(script_path: &Path) -> std::process::Command {
        let mut cmd = std::process::Command::new("sh");
        cmd.arg(script_path);
        cmd
    }

    fn shell_command_async(script_path: &Path) -> tokio::process::Command {
        let mut cmd = tokio::process::Command::new("sh");
        cmd.arg(script_path);
        cmd
    }

    fn shell_inline(command: &str) -> tokio::process::Command {
        let mut cmd = tokio::process::Command::new("bash");
        cmd.arg("-c").arg(command);
        cmd
    }

    fn kill_process(pid: &str) -> std::io::Result<std::process::Output> {
        std::process::Command::new("kill")
            .arg("-15")
            .arg(pid)
            .output()
    }

    fn find_pids_on_port(port: u16) -> Vec<String> {
        let Ok(output) = std::process::Command::new("lsof")
            .arg(format!("-ti:{}", port))
            .output()
        else {
            return Vec::new();
        };
        let Ok(text) = String::from_utf8(output.stdout) else {
            return Vec::new();
        };
        text.lines()
            .map(|l| l.trim().to_string())
            .filter(|l| !l.is_empty())
            .collect()
    }

    fn tail_file(path: &Path) -> std::io::Result<std::process::Child> {
        std::process::Command::new("tail")
            .arg("-n")
            .arg("200")
            .arg("-f")
            .arg(path)
            .spawn()
    }

    fn restrict_dir_permissions(path: &Path) {
        let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700));
    }

    fn restrict_file_permissions(path: &Path) {
        let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
    }

    fn set_executable(path: &Path) {
        let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755));
    }

    fn install_rustup() -> std::io::Result<std::process::ExitStatus> {
        let install_cmd = "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y";
        std::process::Command::new("sh")
            .args(["-c", install_cmd])
            .status()
    }

    fn cargo_missing_hint() -> &'static str {
        "Cargo not found in current PATH. You might need to run 'source $HOME/.cargo/env'."
    }

    fn sandboxed_path() -> String {
        "/usr/local/bin:/usr/bin:/bin".to_string()
    }

    fn binary_name() -> &'static str {
        "moxxy"
    }

    fn update_platform() -> Option<&'static str> {
        match std::env::consts::ARCH {
            "aarch64" => {
                if cfg!(target_os = "macos") {
                    Some("darwin-aarch64")
                } else {
                    Some("linux-aarch64")
                }
            }
            "x86_64" => {
                if cfg!(target_os = "macos") {
                    Some("darwin-x86_64")
                } else {
                    Some("linux-x86_64")
                }
            }
            _ => None,
        }
    }

    fn installed_binary_path() -> PathBuf {
        dirs::home_dir()
            .expect("Could not find home directory")
            .join(".local")
            .join("bin")
            .join("moxxy")
    }

    fn data_dir() -> PathBuf {
        resolve_data_dir(
            dirs::home_dir()
                .expect("Could not find home directory")
                .join(".moxxy"),
        )
    }
}
