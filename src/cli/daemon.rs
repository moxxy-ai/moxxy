use anyhow::Result;
use console::style;
use std::path::Path;

use crate::core::terminal::{GuideSection, print_error, print_info, print_warn};
use crate::platform::{NativePlatform, Platform};

pub async fn gateway_start(
    run_dir: &Path,
    pid_file: &Path,
    api_host: &str,
    api_port: u16,
    args: &[String],
) -> Result<()> {
    std::fs::create_dir_all(run_dir)?;
    NativePlatform::restrict_dir_permissions(run_dir);
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

    GuideSection::new("Gateway Started")
        .status(
            "Status",
            &format!(
                "{} (PID {})",
                style("RUNNING").green().bold(),
                style(child.id()).dim()
            ),
        )
        .status("API Endpoint", &format!("http://{}:{}", api_host, api_port))
        .blank()
        .info(&format!(
            "Run {} to open the dashboard.",
            style("moxxy web").cyan().bold()
        ))
        .print();
    println!();

    Ok(())
}

pub async fn gateway_stop(pid_file: &Path) -> Result<()> {
    let mut daemon_stopped = false;
    if pid_file.exists() {
        if let Ok(pid_str) = std::fs::read_to_string(pid_file) {
            let pid = pid_str.trim();
            if !pid.is_empty() {
                let _ = NativePlatform::kill_process(pid);
                GuideSection::new("Gateway Stopped")
                    .status(
                        "Status",
                        &format!(
                            "{} (was PID {})",
                            style("STOPPED").red().bold(),
                            style(pid).dim()
                        ),
                    )
                    .print();
                daemon_stopped = true;
            }
        }
        std::fs::remove_file(pid_file).ok();
    }

    if !daemon_stopped {
        print_info("Gateway is not currently running.");
    }

    // Also kill the web service if it's running on port 17890
    for pid in NativePlatform::find_pids_on_port(17890) {
        let _ = NativePlatform::kill_process(&pid);
        print_info(&format!(
            "Cleaned up process on port {} (PID {})",
            style("17890").cyan(),
            style(&pid).bold()
        ));
    }

    println!();
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
        GuideSection::new("Gateway Status")
            .status(
                "Gateway",
                &format!(
                    "{} (PID {})",
                    style("RUNNING").green().bold(),
                    style(pid_str.trim()).dim()
                ),
            )
            .print();
    } else {
        GuideSection::new("Gateway Status")
            .status("Gateway", &style("STOPPED").red().bold().to_string())
            .blank()
            .info(&format!(
                "Run {} to start the daemon.",
                style("moxxy gateway start").cyan().bold()
            ))
            .print();
    }
    println!();
    Ok(())
}

pub async fn follow_logs(run_dir: &Path, pid_file: &Path) -> Result<()> {
    if pid_file.exists() && std::fs::read_to_string(pid_file).is_ok() {
        let log_file = run_dir.join("moxxy.log");
        if log_file.exists() {
            GuideSection::new("Live Logs")
                .text(&format!(
                    "Following {} - press {} to stop.",
                    style("moxxy.log").cyan(),
                    style("Ctrl+C").bold().yellow()
                ))
                .print();
            println!();
            let mut child = NativePlatform::tail_file(&log_file)?;
            let _ = child.wait()?;
        } else {
            print_error(&format!(
                "Log file not found at {}",
                style(log_file.display()).dim()
            ));
        }
    } else {
        GuideSection::new("Live Logs")
            .warn("Gateway is not running.")
            .blank()
            .info(&format!(
                "Run {} to start it.",
                style("moxxy gateway start").cyan().bold()
            ))
            .print();
        println!();
    }
    Ok(())
}
