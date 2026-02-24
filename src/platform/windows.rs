use std::path::{Path, PathBuf};

use super::Platform;

pub struct NativePlatform;

impl Platform for NativePlatform {
    fn default_shell() -> &'static str {
        "bash"
    }

    fn shell_command(script_path: &Path) -> std::process::Command {
        let mut cmd = std::process::Command::new("bash");
        cmd.arg(script_path);
        cmd
    }

    fn shell_command_async(script_path: &Path) -> tokio::process::Command {
        let mut cmd = tokio::process::Command::new("bash");
        cmd.arg(script_path);
        cmd
    }

    fn shell_inline(command: &str) -> tokio::process::Command {
        let mut cmd = tokio::process::Command::new("bash");
        cmd.arg("-c").arg(command);
        cmd
    }

    fn kill_process(pid: &str) -> std::io::Result<std::process::Output> {
        std::process::Command::new("taskkill")
            .args(["/PID", pid, "/F"])
            .output()
    }

    fn find_pids_on_port(port: u16) -> Vec<String> {
        let Ok(output) = std::process::Command::new("cmd")
            .args(["/c", &format!("netstat -ano | findstr :{}", port)])
            .output()
        else {
            return Vec::new();
        };
        let Ok(text) = String::from_utf8(output.stdout) else {
            return Vec::new();
        };
        let mut pids = Vec::new();
        for line in text.lines() {
            if let Some(pid) = line.split_whitespace().last() {
                let pid = pid.trim();
                if !pid.is_empty() && pid.chars().all(|c| c.is_ascii_digit()) {
                    pids.push(pid.to_string());
                }
            }
        }
        pids.sort();
        pids.dedup();
        pids
    }

    fn tail_file(path: &Path) -> std::io::Result<std::process::Child> {
        std::process::Command::new("powershell")
            .args([
                "-Command",
                &format!("Get-Content -Path '{}' -Tail 200 -Wait", path.display()),
            ])
            .spawn()
    }

    fn restrict_dir_permissions(_path: &Path) {
        // Windows uses ACLs; no simple equivalent to Unix mode bits.
    }

    fn restrict_file_permissions(_path: &Path) {
        // Windows uses ACLs; no simple equivalent to Unix mode bits.
    }

    fn set_executable(_path: &Path) {
        // On Windows, executability is determined by file extension, not permissions.
    }

    fn install_rustup() -> std::io::Result<std::process::ExitStatus> {
        let install_cmd = "Invoke-WebRequest -Uri https://win.rustup.rs/x86_64 -OutFile $env:TEMP\\rustup-init.exe; & $env:TEMP\\rustup-init.exe -y";
        std::process::Command::new("powershell")
            .args(["-Command", install_cmd])
            .status()
    }

    fn cargo_missing_hint() -> &'static str {
        "Cargo not found in current PATH. You might need to restart your terminal."
    }

    fn sandboxed_path() -> String {
        std::env::var("PATH").unwrap_or_default()
    }

    fn binary_name() -> &'static str {
        "moxxy.exe"
    }

    fn update_platform() -> Option<&'static str> {
        match std::env::consts::ARCH {
            "x86_64" => Some("windows-x86_64"),
            "aarch64" => Some("windows-aarch64"),
            _ => None,
        }
    }

    fn installed_binary_path() -> PathBuf {
        std::env::current_exe().unwrap_or_else(|_| PathBuf::from("moxxy.exe"))
    }
}
