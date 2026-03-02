use moxxy_gateway::{create_router, state::AppState};
use rusqlite::Connection;
use std::sync::Arc;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();

    let db_path = std::env::var("MOXXY_DB_PATH").unwrap_or_else(|_| "moxxy.db".into());
    let host = std::env::var("MOXXY_HOST").unwrap_or_else(|_| "127.0.0.1".into());
    let port = std::env::var("MOXXY_PORT").unwrap_or_else(|_| "3000".into());
    let addr = format!("{host}:{port}");

    let conn = Connection::open(&db_path).expect("Failed to open SQLite database");
    let state = Arc::new(AppState::new(conn));
    let app = create_router(state);

    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .expect("Failed to bind address");

    tracing::info!("Moxxy gateway listening on http://{addr}");
    tracing::info!("Database: {db_path}");

    axum::serve(listener, app).await.expect("Server error");
}
