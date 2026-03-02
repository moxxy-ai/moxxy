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
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "moxxy_gateway=info,tower_http=info".into()),
        )
        .with_target(true)
        .init();

    let home = moxxy_home();
    let db_path = std::env::var("MOXXY_DB_PATH")
        .unwrap_or_else(|_| home.join("moxxy.db").to_string_lossy().to_string());
    let host = std::env::var("MOXXY_HOST").unwrap_or_else(|_| "127.0.0.1".into());
    let port = std::env::var("MOXXY_PORT").unwrap_or_else(|_| "3000".into());
    let addr = format!("{host}:{port}");

    let conn = Connection::open(&db_path).expect("Failed to open SQLite database");
    let state = Arc::new(AppState::new(conn));
    state.spawn_event_persistence();
    state.spawn_heartbeat_loop();

    // Start channel bridge
    {
        use moxxy_vault::SecretBackend;

        let mut bridge = moxxy_channel::ChannelBridge::new(
            state.db.clone(),
            state.event_bus.clone(),
            state.run_service.clone(),
        );

        // Load active channels and resolve bot tokens from vault
        let channels = {
            let db = state.db.lock().unwrap();
            db.channels().list_active().unwrap_or_default()
        };

        for channel in &channels {
            // Resolve bot token: channel -> vault_secret_ref -> backend_key -> vault_backend
            let bot_token = {
                let db = state.db.lock().unwrap();
                db.vault_refs()
                    .find_by_id(&channel.vault_secret_ref_id)
                    .ok()
                    .flatten()
                    .and_then(|secret_ref| {
                        state.vault_backend.get_secret(&secret_ref.backend_key).ok()
                    })
            };

            match (channel.channel_type.as_str(), bot_token) {
                ("telegram", Some(token)) => {
                    let transport = Arc::new(moxxy_channel::TelegramTransport::new(token));
                    bridge.register_transport_mut(channel.id.clone(), transport);
                    tracing::info!(
                        "Telegram channel loaded: {} ({})",
                        channel.display_name,
                        channel.id
                    );
                }
                ("telegram", None) => {
                    tracing::warn!(
                        "Telegram channel {} has no bot token in vault, skipping",
                        channel.id
                    );
                }
                ("discord", _) => {
                    tracing::info!("Discord channel {} registered (scaffold only)", channel.id);
                }
                (other, _) => {
                    tracing::warn!("Unknown channel type: {}", other);
                }
            }
        }

        let bridge = Arc::new(bridge);
        bridge.clone().start();

        // Inject channel sender into RunService for ChannelNotifyPrimitive
        state.run_service.set_channel_sender(Arc::new(
            moxxy_gateway::run_service::BridgeChannelAdapter::new(bridge.clone()),
        ));

        // Store bridge in state for runtime channel registration
        *state.channel_bridge.lock().unwrap() = Some(bridge);

        if !channels.is_empty() {
            tracing::info!("Channel bridge started with {} active channels", channels.len());
        }
    }

    let app = create_router(state);

    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .expect("Failed to bind address");

    tracing::info!("Moxxy home: {}", home.display());
    tracing::info!("Moxxy gateway listening on http://{addr}");
    tracing::info!("Database: {db_path}");

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .expect("Server error");
}

async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c()
            .await
            .expect("Failed to install Ctrl+C handler");
    };

    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("Failed to install SIGTERM handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => { tracing::info!("Received Ctrl+C, shutting down..."); }
        _ = terminate => { tracing::info!("Received SIGTERM, shutting down..."); }
    }
}
