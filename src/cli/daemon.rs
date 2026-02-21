use anyhow::Result;
use std::path::Path;

use crate::core::terminal::{print_error, print_info, print_success, print_warn};

pub async fn gateway_start(
    run_dir: &Path,
    pid_file: &Path,
    api_host: &str,
    api_port: u16,
    args: &[String],
) -> Result<()> {
    std::fs::create_dir_all(run_dir)?;
    if pid_file.exists() && std::fs::read_to_string(pid_file).is_ok() {
        print_warn("Daemon is already running. Use 'moxxy gateway stop' first.");
        return Ok(());
    }

    let mut api_host = api_host.to_string();
    let mut api_port = api_port;

    let mut i = 3;
    while i < args.len() {
        match args[i].as_str() {
            "--api-port" => {
                if i + 1 < args.len() {
                    api_port = args[i + 1].parse().unwrap_or(17890);
                    i += 2;
                } else {
                    i += 1;
                }
            }
            "--api-host" => {
                if i + 1 < args.len() {
                    api_host = args[i + 1].clone();
                    i += 2;
                } else {
                    i += 1;
                }
            }
            _ => i += 1,
        }
    }

    let log_file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(run_dir.join("moxxy.log"))?;

    let exe = std::env::current_exe()?;
    let mut child_cmd = std::process::Command::new(exe);
    child_cmd.arg("daemon-run");
    if api_port != 17890 {
        child_cmd.arg("--api-port").arg(api_port.to_string());
    }
    if api_host != "127.0.0.1" {
        child_cmd.arg("--api-host").arg(&api_host);
    }

    let child = child_cmd
        .stdin(std::process::Stdio::null())
        .stdout(log_file.try_clone()?)
        .stderr(log_file)
        .spawn()?;

    std::fs::write(pid_file, child.id().to_string())?;
    print_success(&format!(
        "moxxy Swarm started as background daemon (PID {}).",
        child.id()
    ));
    Ok(())
}

pub async fn gateway_stop(pid_file: &Path) -> Result<()> {
    let mut daemon_stopped = false;
    if pid_file.exists() {
        if let Ok(pid_str) = std::fs::read_to_string(pid_file) {
            let pid = pid_str.trim();
            if !pid.is_empty() {
                let _ = std::process::Command::new("kill")
                    .arg("-15")
                    .arg(pid)
                    .output();
                print_success(&format!("Successfully stopped moxxy Daemon (PID {}).", pid));
                daemon_stopped = true;
            }
        }
        std::fs::remove_file(pid_file).ok();
    }

    if !daemon_stopped {
        print_info("Daemon is not currently running.");
    }

    // Also kill the web service if it's running on port 17890
    if let Ok(output) = std::process::Command::new("lsof").arg("-ti:17890").output()
        && let Ok(pids) = String::from_utf8(output.stdout)
    {
        for pid in pids.lines() {
            let pid = pid.trim();
            if !pid.is_empty() {
                let _ = std::process::Command::new("kill")
                    .arg("-15")
                    .arg(pid)
                    .output();
                print_success(&format!(
                    "Successfully stopped process on port 17890 (PID {}).",
                    pid
                ));
            }
        }
    }

    Ok(())
}

pub async fn gateway_restart() -> Result<()> {
    let exe = std::env::current_exe()?;
    let _ = std::process::Command::new(&exe)
        .arg("gateway")
        .arg("stop")
        .status();
    let _ = std::process::Command::new(&exe)
        .arg("gateway")
        .arg("start")
        .status();
    Ok(())
}

pub async fn gateway_status(pid_file: &Path) -> Result<()> {
    if pid_file.exists() {
        let pid_str = std::fs::read_to_string(pid_file)?;
        print_success(&format!(
            "moxxy Daemon is RUNNING (PID {}).",
            pid_str.trim()
        ));
    } else {
        print_info("moxxy Daemon is STOPPED.");
    }
    Ok(())
}

pub async fn follow_logs(run_dir: &Path, pid_file: &Path) -> Result<()> {
    if pid_file.exists() && std::fs::read_to_string(pid_file).is_ok() {
        let log_file = run_dir.join("moxxy.log");
        if log_file.exists() {
            let mut child = std::process::Command::new("tail")
                .arg("-n")
                .arg("200")
                .arg("-f")
                .arg(&log_file)
                .spawn()?;
            let _ = child.wait()?;
        } else {
            print_error(&format!("Log file not found at {:?}", log_file));
        }
    } else {
        print_error("Daemon is not currently running. Start it with 'moxxy gateway start'.");
    }
    Ok(())
}
