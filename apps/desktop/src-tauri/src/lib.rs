//! moxxy desktop — Tauri shell.
//!
//! Capability traits compose via [`app_state::AppState`]:
//!   * [`sidecar::Sidecar`] — supervises a child process.
//!   * [`transport::RunnerTransport`] — opens a duplex stream to it.
//!   * [`desks::DeskStore`] — persists the user's workspaces.
//!
//! `commands::*` are the Tauri command handlers (the JS-callable surface).

#![cfg_attr(feature = "strict", deny(warnings))]
#![deny(unsafe_code)]
#![warn(clippy::pedantic)]
#![allow(
    clippy::missing_errors_doc,
    clippy::missing_panics_doc,
    clippy::module_name_repetitions,
    clippy::must_use_candidate,
    clippy::needless_pass_by_value
)]

pub mod app_state;
pub mod commands;
pub mod desks;
pub mod error;
pub mod sidecar;
pub mod transport;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "moxxy_desktop_lib=info,warn".into()),
        )
        .with_target(false)
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .setup(|app| {
            use tauri::Manager;
            let state = app_state::AppState::production(app.handle())?;
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::sidecar_status,
            commands::desks_list,
            commands::desks_upsert,
            commands::desks_remove,
            commands::desks_set_active,
            commands::desks_active,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
