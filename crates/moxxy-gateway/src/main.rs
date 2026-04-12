use moxxy_gateway::{create_router, rate_limit::RateLimitConfig, state::AppState};
use moxxy_types::AuthMode;
use rand::RngCore;
use rusqlite::Connection;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;

/// Loads or generates the 256-bit vault master key.
/// Priority: MOXXY_VAULT_KEY env var (hex) → ~/.moxxy/vault.key file → generate new key.
fn load_vault_key(home: &std::path::Path) -> [u8; 32] {
    // 1. Check env var (hex-encoded 32 bytes = 64 hex chars)
    if let Ok(hex_key) = std::env::var("MOXXY_VAULT_KEY") {
        let bytes = hex::decode(hex_key.trim()).expect("MOXXY_VAULT_KEY must be 64 hex characters");
        let mut key = [0u8; 32];
        assert!(
            bytes.len() == 32,
            "MOXXY_VAULT_KEY must be exactly 32 bytes (64 hex chars)"
        );
        key.copy_from_slice(&bytes);
        tracing::info!("Vault key loaded from MOXXY_VAULT_KEY env var");
        return key;
    }

    // 2. Check key file
    let key_path = home.join("vault.key");
    if key_path.exists() {
        let contents = std::fs::read(&key_path).expect("Failed to read vault.key");
        assert!(contents.len() == 32, "vault.key must be exactly 32 bytes");
        let mut key = [0u8; 32];
        key.copy_from_slice(&contents);
        tracing::info!("Vault key loaded from {}", key_path.display());
        return key;
    }

    // 3. Generate new key and write to file
    let mut key = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut key);
    std::fs::write(&key_path, key).expect("Failed to write vault.key");

    // Set file permissions to 0600 (owner read/write only)
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&key_path, std::fs::Permissions::from_mode(0o600))
            .expect("Failed to set vault.key permissions");
    }

    tracing::info!("Generated new vault key at {}", key_path.display());
    key
}

/// Returns the moxxy home directory: ~/.moxxy
/// Creates it (and subdirectories) if they don't exist.
fn moxxy_home() -> PathBuf {
    let home = std::env::var("MOXXY_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            dirs::home_dir()
                .expect("Could not determine home directory")
                .join(".moxxy")
        });

    // Create directory structure
    std::fs::create_dir_all(home.join("agents")).expect("Failed to create ~/.moxxy/agents");
    std::fs::create_dir_all(home.join("channels")).expect("Failed to create ~/.moxxy/channels");
    std::fs::create_dir_all(home.join("config")).expect("Failed to create ~/.moxxy/config");

    home
}

#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() > 1 && (args[1] == "--version" || args[1] == "-V") {
        println!("moxxy-gateway {}", env!("CARGO_PKG_VERSION"));
        return;
    }

    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "moxxy_gateway=info,moxxy_runtime=info,tower_http=info".into()),
        )
        .with_target(true)
        .init();

    let home = moxxy_home();
    let db_path = std::env::var("MOXXY_DB_PATH")
        .unwrap_or_else(|_| home.join("moxxy.db").to_string_lossy().to_string());
    let host = std::env::var("MOXXY_HOST").unwrap_or_else(|_| "127.0.0.1".into());
    let port = std::env::var("MOXXY_PORT").unwrap_or_else(|_| "3000".into());
    let addr = format!("{host}:{port}");

    let vault_key = load_vault_key(&home);

    // Resolve auth mode: env var overrides config file.
    // Default is loopback (no token needed from localhost).
    // Set MOXXY_LOOPBACK=false to require tokens.
    let auth_mode = if let Ok(val) = std::env::var("MOXXY_LOOPBACK") {
        if val == "false" || val == "0" {
            AuthMode::Token
        } else {
            AuthMode::Loopback
        }
    } else {
        let config_path = home.join("config").join("gateway.yaml");
        std::fs::read_to_string(&config_path)
            .ok()
            .and_then(|s| serde_yaml::from_str::<serde_yaml::Value>(&s).ok())
            .and_then(|v| {
                v.get("auth_mode")
                    .and_then(|m| m.as_str())
                    .map(String::from)
            })
            .map(|s| AuthMode::from_config_str(&s))
            .unwrap_or_default()
    };

    let base_url =
        std::env::var("MOXXY_BASE_URL").unwrap_or_else(|_| format!("http://{}:{}", host, port));

    moxxy_gateway::state::register_sqlite_vec();
    let conn = Connection::open(&db_path).expect("Failed to open SQLite database");
    let state = Arc::new(AppState::new(
        conn,
        vault_key,
        auth_mode,
        home.clone(),
        base_url,
    ));
    state.spawn_event_persistence();
    state.spawn_heartbeat_loop();
    state.spawn_health_check_loop();
    state.spawn_drain_loop();

    // Start channel bridge
    {
        let (stt, stt_settings) = state.stt_snapshot();
        let mut bridge = moxxy_channel::ChannelBridge::new_with_stt(
            state.db.clone(),
            state.event_bus.clone(),
            state.run_service.clone(),
            state.vault_backend.clone(),
            state.moxxy_home.clone(),
            stt,
            stt_settings,
        );

        // Load active channels from YAML and resolve bot tokens from vault
        let channels = moxxy_core::ChannelStore::list_active(&home);

        for (channel_id, doc) in &channels {
            // Resolve bot token: channel doc -> vault_secret_ref -> backend_key -> vault_backend
            let bot_token = {
                let db = state.db.lock().unwrap();
                db.vault_refs()
                    .find_by_id(&doc.vault_secret_ref_id)
                    .ok()
                    .flatten()
                    .and_then(|secret_ref| {
                        state.vault_backend.get_secret(&secret_ref.backend_key).ok()
                    })
            };

            match (doc.channel_type.as_str(), bot_token) {
                ("telegram", Some(token)) => {
                    let transport = Arc::new(moxxy_channel::TelegramTransport::new(token));
                    bridge.register_transport_mut(channel_id.clone(), transport);
                    tracing::info!(
                        "Telegram channel loaded: {} ({})",
                        doc.display_name,
                        channel_id
                    );
                }
                ("telegram", None) => {
                    tracing::warn!(
                        "Telegram channel {} has no bot token in vault, skipping",
                        channel_id
                    );
                }
                ("discord", _) => {
                    tracing::info!("Discord channel {} registered (scaffold only)", channel_id);
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

        // Enable agent sub-agent spawning by providing the RunStarter
        state.run_service.set_run_starter(state.run_service.clone());

        // Log active bindings for diagnostics
        for (channel_id, _doc) in &channels {
            let bindings = moxxy_core::ChannelStore::find_bindings_by_channel(&home, channel_id);
            if bindings.is_empty() {
                tracing::warn!(
                    channel_id = %channel_id,
                    "Channel has no active bindings"
                );
            } else {
                for (chat_id, entry) in &bindings {
                    tracing::info!(
                        channel_id = %channel_id,
                        agent_name = %entry.agent_name,
                        external_chat_id = %chat_id,
                        binding_status = %entry.status,
                        "Active channel binding loaded"
                    );
                }
            }
        }

        if !channels.is_empty() {
            tracing::info!(
                "Channel bridge started with {} active channels",
                channels.len()
            );
        }
    }

    // In loopback mode, use permissive rate limits unless explicitly configured
    let rate_limit_config = if auth_mode.is_loopback()
        && std::env::var("MOXXY_RATE_LIMIT_PER_SEC").is_err()
        && std::env::var("MOXXY_RATE_LIMIT_DISABLED").is_err()
    {
        tracing::info!("Loopback mode: using permissive rate limits");
        RateLimitConfig::permissive()
    } else {
        RateLimitConfig::from_env()
    };

    let app = create_router(state.clone(), Some(rate_limit_config));

    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .expect("Failed to bind address");

    tracing::info!("Moxxy home: {}", home.display());
    tracing::info!("Moxxy gateway listening on http://{addr}");
    tracing::info!("Database: {db_path}");
    tracing::info!("Auth mode: {auth_mode}");

    if auth_mode == AuthMode::Loopback {
        tracing::warn!(
            "Auth mode is LOOPBACK - any process on localhost can access the API without a token. \
             Set MOXXY_LOOPBACK=false to require tokens."
        );
    }

    match std::env::var("MOXXY_CORS_ORIGINS") {
        Ok(ref origins) => tracing::info!("CORS origins: {origins}"),
        Err(_) => tracing::info!(
            "CORS origins: localhost defaults (http://localhost:3000, http://127.0.0.1:3000, \
             http://localhost:17900, http://127.0.0.1:17900, \
             http://localhost:17901, http://127.0.0.1:17901)"
        ),
    }

    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown_signal())
    .await
    .expect("Server error");

    // Gracefully shut down the channel bridge (stops Telegram polling, etc.)
    if let Ok(bridge_lock) = state.channel_bridge.lock()
        && let Some(bridge) = bridge_lock.as_ref()
    {
        tracing::info!("Shutting down channel bridge...");
        bridge.shutdown();
    }

    // Stop all active agent runs
    state.run_service.shutdown_all();

    tracing::info!("Gateway shutdown complete.");
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
