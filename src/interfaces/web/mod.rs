pub(crate) mod auth;
mod handlers;
mod router;

use anyhow::Result;
use async_trait::async_trait;
use axum::{
    Json, Router,
    extract::State,
    response::IntoResponse,
    response::sse::{Event, Sse},
    routing::get,
};
use include_dir::{Dir, include_dir};
use std::convert::Infallible;
use tokio_stream::Stream;
use tokio_stream::StreamExt;
use tokio_stream::wrappers::BroadcastStream;
use tower_http::cors::CorsLayer;
use tracing::info;

static FRONTEND_DIR: Dir = include_dir!("$CARGO_MANIFEST_DIR/frontend/dist");

use crate::core::agent::{
    ContainerRegistry, LlmRegistry, MemoryRegistry, RunMode, ScheduledJobRegistry,
    SchedulerRegistry, SkillRegistry,
};
use crate::core::lifecycle::LifecycleComponent;

pub struct ApiServer {
    registry: MemoryRegistry,
    skill_registry: SkillRegistry,
    llm_registry: LlmRegistry,
    container_registry: ContainerRegistry,
    scheduler_registry: SchedulerRegistry,
    scheduled_job_registry: ScheduledJobRegistry,
    log_tx: tokio::sync::broadcast::Sender<String>,
    run_mode: RunMode,
    api_host: String,
    api_port: u16,
    web_port: u16,
    internal_token: String,
}

pub struct ApiServerConfig {
    pub registry: MemoryRegistry,
    pub skill_registry: SkillRegistry,
    pub llm_registry: LlmRegistry,
    pub container_registry: ContainerRegistry,
    pub scheduler_registry: SchedulerRegistry,
    pub scheduled_job_registry: ScheduledJobRegistry,
    pub log_tx: tokio::sync::broadcast::Sender<String>,
    pub run_mode: RunMode,
    pub api_host: String,
    pub api_port: u16,
    pub web_port: u16,
    pub internal_token: String,
}

#[derive(Clone)]
pub(crate) struct AppState {
    pub(crate) registry: MemoryRegistry,
    pub(crate) skill_registry: SkillRegistry,
    pub(crate) llm_registry: LlmRegistry,
    pub(crate) container_registry: ContainerRegistry,
    pub(crate) scheduler_registry: SchedulerRegistry,
    pub(crate) scheduled_job_registry: ScheduledJobRegistry,
    pub(crate) log_tx: tokio::sync::broadcast::Sender<String>,
    pub(crate) run_mode: RunMode,
    pub(crate) api_host: String,
    pub(crate) api_port: u16,
    pub(crate) web_port: u16,
    pub(crate) internal_token: String,
}

impl ApiServer {
    pub fn new(config: ApiServerConfig) -> Self {
        Self {
            registry: config.registry,
            skill_registry: config.skill_registry,
            llm_registry: config.llm_registry,
            container_registry: config.container_registry,
            scheduler_registry: config.scheduler_registry,
            scheduled_job_registry: config.scheduled_job_registry,
            log_tx: config.log_tx,
            run_mode: config.run_mode,
            api_host: config.api_host,
            api_port: config.api_port,
            web_port: config.web_port,
            internal_token: config.internal_token,
        }
    }
}

pub struct WebServer {
    run_mode: RunMode,
    api_host: String,
    api_port: u16,
    web_port: u16,
}

impl WebServer {
    pub fn new(run_mode: RunMode, api_host: String, api_port: u16, web_port: u16) -> Self {
        Self {
            run_mode,
            api_host,
            api_port,
            web_port,
        }
    }
}

// --- SSE Logs (used by router) ---

async fn sse_logs_endpoint(
    State(state): State<AppState>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let receiver = state.log_tx.subscribe();
    let stream = BroadcastStream::new(receiver).map(|msg| {
        match msg {
            Ok(log) => Ok(Event::default().data(log)), // SSE properly encodes this
            Err(_) => Ok(Event::default().data("Log stream lagged")),
        }
    });

    Sse::new(stream)
}

// --- Lifecycle Implementations ---

#[async_trait]
impl LifecycleComponent for ApiServer {
    async fn on_init(&mut self) -> Result<()> {
        info!("API Server Interface initializing...");
        Ok(())
    }

    async fn on_start(&mut self) -> Result<()> {
        let registry = self.registry.clone();
        let skill_registry = self.skill_registry.clone();
        let llm_registry = self.llm_registry.clone();
        let container_registry = self.container_registry.clone();
        let scheduler_registry = self.scheduler_registry.clone();
        let scheduled_job_registry = self.scheduled_job_registry.clone();
        let log_tx = self.log_tx.clone();
        let run_mode = self.run_mode.clone();
        let api_host = self.api_host.clone();
        let api_port = self.api_port;
        let web_port = self.web_port;
        let internal_token = self.internal_token.clone();

        tokio::spawn(async move {
            let addr = format!("{}:{}", api_host, api_port);
            let state = AppState {
                registry,
                skill_registry,
                llm_registry,
                container_registry,
                scheduler_registry,
                scheduled_job_registry,
                log_tx,
                run_mode,
                api_host,
                api_port,
                web_port,
                internal_token,
            };
            let app = router::build_api_router(state);

            if let Ok(listener) = tokio::net::TcpListener::bind(&addr).await {
                info!("API Server running at http://{addr}");
                if let Err(e) = axum::serve(listener, app).await {
                    tracing::error!("API Server crashed: {}", e);
                }
            }
        });
        Ok(())
    }

    async fn on_shutdown(&mut self) -> Result<()> {
        info!("API Server Interface shutting down...");
        Ok(())
    }
}

async fn web_static_handler(uri: axum::http::Uri) -> impl axum::response::IntoResponse {
    let mut path = uri.path().trim_start_matches('/');
    if path.is_empty() {
        path = "index.html";
    }

    match FRONTEND_DIR.get_file(path) {
        Some(file) => {
            let mime = mime_guess::from_path(path).first_or_octet_stream();
            (
                [(axum::http::header::CONTENT_TYPE, mime.as_ref())],
                file.contents(),
            )
                .into_response()
        }
        None => match FRONTEND_DIR.get_file("index.html") {
            Some(file) => {
                let mime = mime_guess::from_path("index.html").first_or_octet_stream();
                (
                    [(axum::http::header::CONTENT_TYPE, mime.as_ref())],
                    file.contents(),
                )
                    .into_response()
            }
            None => (axum::http::StatusCode::NOT_FOUND, "404 Not Found").into_response(),
        },
    }
}

#[async_trait]
impl LifecycleComponent for WebServer {
    async fn on_init(&mut self) -> Result<()> {
        info!("Web Static Dashboard Interface initializing...");
        Ok(())
    }

    async fn on_start(&mut self) -> Result<()> {
        if self.run_mode != RunMode::Web {
            return Ok(());
        }

        let api_host = self.api_host.clone();
        let api_port = self.api_port;
        let web_port = self.web_port;

        tokio::spawn(async move {
            let api_url = format!("http://{}:{}/api", api_host, api_port);
            let config_json = serde_json::json!({
                "api_base": api_url
            });

            let origins: Vec<axum::http::HeaderValue> = [
                format!("http://127.0.0.1:{}", web_port),
                format!("http://localhost:{}", web_port),
                format!("http://127.0.0.1:{}", api_port),
                format!("http://localhost:{}", api_port),
            ]
            .iter()
            .filter_map(|o| o.parse().ok())
            .collect();

            let cors = CorsLayer::new()
                .allow_origin(origins)
                .allow_methods([axum::http::Method::GET, axum::http::Method::OPTIONS])
                .allow_headers(tower_http::cors::Any);

            let app = Router::new()
                .route(
                    "/config.json",
                    get(move || async move { Json(config_json.clone()) }),
                )
                .layer(cors)
                .fallback(web_static_handler);

            let addr = format!("127.0.0.1:{}", web_port);
            if let Ok(listener) = tokio::net::TcpListener::bind(&addr).await {
                info!("Web Dashboard running at http://{}", addr);
                let _ = open::that(format!("http://{}", addr)); // Auto-launch browser
                if let Err(e) = axum::serve(listener, app).await {
                    tracing::error!("Web Dashboard Server crashed: {}", e);
                }
            }
        });
        Ok(())
    }

    async fn on_shutdown(&mut self) -> Result<()> {
        info!("Web Static Dashboard Interface shutting down...");
        Ok(())
    }
}
