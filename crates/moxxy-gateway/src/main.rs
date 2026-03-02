use moxxy_gateway::{create_router, state::AppState};
use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::Arc;

/// Returns the moxxy home directory: ~/.moxxy
/// Creates it (and subdirectories) if they don't exist.
fn moxxy_home() -> PathBuf {
    let home = std::env::var("MOXXY_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            let home = std::env::var("HOME").expect("HOME environment variable not set");
            PathBuf::from(home).join(".moxxy")
        });

    // Create directory structure
    std::fs::create_dir_all(home.join("agents")).expect("Failed to create ~/.moxxy/agents");
    std::fs::create_dir_all(home.join("config")).expect("Failed to create ~/.moxxy/config");

    home
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();

    let home = moxxy_home();
    let db_path = std::env::var("MOXXY_DB_PATH")
        .unwrap_or_else(|_| home.join("moxxy.db").to_string_lossy().to_string());
    let host = std::env::var("MOXXY_HOST").unwrap_or_else(|_| "127.0.0.1".into());
    let port = std::env::var("MOXXY_PORT").unwrap_or_else(|_| "3000".into());
    let addr = format!("{host}:{port}");

    let conn = Connection::open(&db_path).expect("Failed to open SQLite database");
    let state = Arc::new(AppState::new(conn));
    let app = create_router(state);

    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .expect("Failed to bind address");

    tracing::info!("Moxxy home: {}", home.display());
    tracing::info!("Moxxy gateway listening on http://{addr}");
    tracing::info!("Database: {db_path}");

    axum::serve(listener, app).await.expect("Server error");
}
