use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::IntoResponse;
use axum::Json;
use moxxy_types::TokenScope;
use std::convert::Infallible;
use std::sync::Arc;
use std::time::Duration;

use crate::auth_extractor::{check_scope, AuthToken};
use crate::state::AppState;

#[derive(serde::Deserialize, Default)]
pub struct EventStreamParams {
    pub agent_id: Option<String>,
    pub run_id: Option<String>,
}

pub async fn event_stream(
    State(state): State<Arc<AppState>>,
    auth: AuthToken,
    Query(params): Query<EventStreamParams>,
) -> Result<impl IntoResponse, (StatusCode, Json<serde_json::Value>)> {
    check_scope(&auth.0, &TokenScope::EventsRead)?;

    let mut rx = state.event_bus.subscribe();

    let stream = async_stream::stream! {
        yield Ok::<_, Infallible>(Event::default().comment("connected"));

        loop {
            match rx.recv().await {
                Ok(envelope) => {
                    if let Some(ref filter_agent) = params.agent_id {
                        if &envelope.agent_id != filter_agent {
                            continue;
                        }
                    }
                    if let Some(ref filter_run) = params.run_id {
                        match &envelope.run_id {
                            Some(run_id) if run_id == filter_run => {}
                            _ => continue,
                        }
                    }

                    let event_type = serde_json::to_string(&envelope.event_type)
                        .unwrap_or_default()
                        .trim_matches('"')
                        .to_string();
                    let data = serde_json::to_string(&envelope).unwrap_or_default();
                    yield Ok::<_, Infallible>(
                        Event::default().event(event_type).data(data)
                    );
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
            }
        }
    };

    Ok(Sse::new(stream).keep_alive(KeepAlive::new().interval(Duration::from_secs(30))))
}
