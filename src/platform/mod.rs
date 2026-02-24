use std::path::{Path, PathBuf};

/// Platform-specific operations abstracted behind a common interface.
/// Each OS provides its own `NativePlatform` implementation so call sites
/// remain free of `#[cfg]` blocks.
pub trait Platform {
    /// Default shell binary for running skill scripts (e.g. `"sh"` / `"bash"`).
    fn default_shell() -> &'static str;

    /// Build a `Command` that executes a script file through the platform shell.
    fn shell_command(script_path: &Path) -> std::process::Command;

    /// Build a **tokio** `Command` that executes a script file through the platform shell.
    fn shell_command_async(script_path: &Path) -> tokio::process::Command;

    /// Build a **tokio** `Command` that runs an inline shell string.
    fn shell_inline(command: &str) -> tokio::process::Command;

    /// Send a termination signal to the process identified by `pid`.
    fn kill_process(pid: &str) -> std::io::Result<std::process::Output>;

    /// Return PIDs of processes listening on `port`.
    fn find_pids_on_port(port: u16) -> Vec<String>;

    /// Spawn a child that tails / follows a log file.
    fn tail_file(path: &Path) -> std::io::Result<std::process::Child>;

    /// Set restrictive *directory* permissions (0o700 on Unix, no-op on Windows).
    fn restrict_dir_permissions(path: &Path);

    /// Set restrictive *file* permissions (0o600 on Unix, no-op on Windows).
    fn restrict_file_permissions(path: &Path);

    /// Mark a file as executable (0o755 on Unix, no-op on Windows).
    fn set_executable(path: &Path);

    /// Install rustup non-interactively.
    fn install_rustup() -> std::io::Result<std::process::ExitStatus>;

    /// Human-readable hint shown when `cargo` is not on PATH.
    fn cargo_missing_hint() -> &'static str;

    /// Default `PATH` value for sandboxed (non-privileged) skill execution.
    fn sandboxed_path() -> String;

    /// Binary filename for this platform (`"moxxy"` / `"moxxy.exe"`).
    fn binary_name() -> &'static str;

    /// Platform identifier used for release downloads (e.g. `"darwin-aarch64"`).
    fn update_platform() -> Option<&'static str>;

    /// Conventional install location of the moxxy binary for uninstall purposes.
    fn installed_binary_path() -> PathBuf;

    /// Root data directory for moxxy.
    /// Unix: `~/.moxxy`, Windows: `%APPDATA%\moxxy`.
    fn data_dir() -> PathBuf;
}

#[cfg(unix)]
mod unix;
#[cfg(unix)]
pub use unix::NativePlatform;

#[cfg(windows)]
mod windows;
#[cfg(windows)]
pub use windows::NativePlatform;
