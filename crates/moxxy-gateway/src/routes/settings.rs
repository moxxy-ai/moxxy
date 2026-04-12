//! System settings HTTP routes.
//!
//! Currently exposes the speech-to-text (`stt`) section of `SystemSettings`
//! so voice message support can be enabled/disabled and reconfigured without
//! restarting the gateway. The settings are persisted to
//! `{moxxy_home}/settings.yaml` and mirrored into the in-memory `AppState`
//! and `ChannelBridge` on every mutation.

use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use moxxy_core::{SttSettings, SystemSettings, settings_path};
use moxxy_storage::VaultSecretRefRow;
use moxxy_types::TokenScope;
use std::sync::Arc;

use crate::auth_extractor::{AuthToken, check_scope};
use crate::state::{AppState, SttBuildError, build_stt_provider};

/// Default backend_key used by the gateway when it provisions a fresh STT
/// secret. Matches the key used by `moxxy init` so the two paths interop.
const DEFAULT_STT_BACKEND_KEY: &str = "moxxy_stt_whisper";
const DEFAULT_STT_KEY_NAME: &str = "STT_WHISPER_API_KEY";
const DEFAULT_STT_POLICY_LABEL: &str = "stt-provider";

type RouteError = (StatusCode, Json<serde_json::Value>);

fn err(status: StatusCode, code: &str, message: impl Into<String>) -> RouteError {
    (
        status,
        Json(serde_json::json!({
            "error": code,
            "message": message.into(),
        })),
    )
}

fn redact(settings: &SttSettings) -> serde_json::Value {
    serde_json::json!({
        "enabled": true,
        "provider": settings.provider,
        "model": settings.model,
        "api_base": settings.api_base,
        "secret_ref": settings.secret_ref,
        "max_seconds": settings.max_seconds,
        "max_bytes": settings.max_bytes,
    })
}

/// `GET /v1/settings/stt` — return the currently active STT config (never
/// the API key itself). When STT is disabled, returns `{enabled: false}`.
pub async fn get_stt(
    State(state): State<Arc<AppState>>,
    auth: AuthToken,
) -> Result<Json<serde_json::Value>, RouteError> {
    check_scope(&auth.0, &TokenScope::SettingsRead)?;

    let (provider, settings) = state.stt_snapshot();
    match (provider, settings) {
        (Some(_), Some(s)) => Ok(Json(redact(&s))),
        _ => Ok(Json(serde_json::json!({ "enabled": false }))),
    }
}

#[derive(serde::Deserialize)]
pub struct SttUpdateRequest {
    /// Provider identifier — currently `whisper` (also accepts `openai`
    /// and `groq` aliases which point at the same multipart API).
    pub provider: String,
    /// Model name (e.g. `whisper-1`).
    pub model: String,
    /// Raw API key. If provided, it is stored in the vault under
    /// `backend_key` before the settings are written. If omitted,
    /// `secret_ref` must already point at a vault entry that exists.
    #[serde(default)]
    pub api_key: Option<String>,
    /// Optional API base URL override (for Groq / self-hosted Whisper).
    #[serde(default)]
    pub api_base: Option<String>,
    /// Vault `backend_key` to use for this STT provider. Defaults to
    /// `moxxy_stt_whisper` if omitted.
    #[serde(default)]
    pub secret_ref: Option<String>,
    /// Friendly key name for the vault row. Ignored when reusing an
    /// existing `secret_ref`.
    #[serde(default)]
    pub key_name: Option<String>,
    #[serde(default)]
    pub max_seconds: Option<u32>,
    #[serde(default)]
    pub max_bytes: Option<usize>,
}

/// `PUT /v1/settings/stt` — configure (or reconfigure) speech-to-text. If
/// an `api_key` is included it is written to the vault before the new
/// settings are applied. The running `ChannelBridge` is updated in place,
/// so voice messages start working on every channel immediately.
pub async fn put_stt(
    State(state): State<Arc<AppState>>,
    auth: AuthToken,
    Json(body): Json<SttUpdateRequest>,
) -> Result<Json<serde_json::Value>, RouteError> {
    check_scope(&auth.0, &TokenScope::SettingsWrite)?;

    let provider = body.provider.trim();
    if provider.is_empty() {
        return Err(err(
            StatusCode::BAD_REQUEST,
            "validation",
            "`provider` is required",
        ));
    }
    let model = body.model.trim();
    if model.is_empty() {
        return Err(err(
            StatusCode::BAD_REQUEST,
            "validation",
            "`model` is required",
        ));
    }

    let secret_ref = body
        .secret_ref
        .clone()
        .unwrap_or_else(|| DEFAULT_STT_BACKEND_KEY.to_string());

    // Persist the API key to the vault first so the build step below can
    // immediately resolve it. We also record a `vault_secrets` row (the
    // higher-level indirection used by the rest of the API).
    if let Some(api_key) = body.api_key.as_ref() {
        if api_key.trim().is_empty() {
            return Err(err(
                StatusCode::BAD_REQUEST,
                "validation",
                "`api_key` must not be empty when provided",
            ));
        }

        state
            .vault_backend
            .set_secret(&secret_ref, api_key)
            .map_err(|e| {
                err(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "vault_write_failed",
                    format!("failed to store api_key: {e}"),
                )
            })?;

        let key_name = body
            .key_name
            .clone()
            .unwrap_or_else(|| DEFAULT_STT_KEY_NAME.to_string());
        let now = chrono::Utc::now().to_rfc3339();
        let row = VaultSecretRefRow {
            id: uuid::Uuid::now_v7().to_string(),
            key_name: key_name.clone(),
            backend_key: secret_ref.clone(),
            policy_label: Some(DEFAULT_STT_POLICY_LABEL.to_string()),
            created_at: now.clone(),
            updated_at: now,
        };

        let db = state.db.lock().unwrap();
        // `insert` fails with a UNIQUE constraint if the ref already exists;
        // that's fine, we've already written the secret value to the backend.
        let _ = db.vault_refs().insert(&row);
    }

    let new_settings = SttSettings {
        provider: provider.to_string(),
        model: model.to_string(),
        api_base: body.api_base.clone(),
        secret_ref: secret_ref.clone(),
        max_seconds: body.max_seconds.unwrap_or(600),
        max_bytes: body.max_bytes.unwrap_or(25 * 1024 * 1024),
    };

    // Build the provider *before* writing settings.yaml so configuration
    // errors surface as 4xx responses instead of a broken-but-persisted state.
    let new_provider =
        build_stt_provider(&new_settings, state.vault_backend.as_ref()).map_err(|e| match e {
            SttBuildError::UnknownProvider(p) => err(
                StatusCode::BAD_REQUEST,
                "unknown_provider",
                format!("unknown stt provider: {p}"),
            ),
            SttBuildError::SecretMissing { key, message } => err(
                StatusCode::BAD_REQUEST,
                "secret_missing",
                format!(
                    "vault secret `{key}` not found: {message}. \
                     Either include `api_key` in the request or pre-seed the vault entry."
                ),
            ),
        })?;

    // Persist to settings.yaml. We load the full settings, swap the stt
    // block, and save — any other sections (network_mode, browser_rendering)
    // are preserved.
    let path = settings_path(&state.moxxy_home);
    let mut file_settings = SystemSettings::load(&path);
    file_settings.stt = Some(new_settings.clone());
    file_settings.save(&path).map_err(|e| {
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "settings_save_failed",
            format!("failed to write settings.yaml: {e}"),
        )
    })?;

    // Swap the in-memory state and propagate to the bridge. After this
    // point, subsequent voice messages will use the new provider.
    state.set_stt(Some(new_provider), Some(new_settings.clone()));

    tracing::info!(
        provider = %new_settings.provider,
        model = %new_settings.model,
        "STT configuration updated via API"
    );

    Ok(Json(redact(&new_settings)))
}

/// `DELETE /v1/settings/stt` — disable voice messages. Removes the `stt`
/// block from `settings.yaml` and clears the in-memory provider. Does not
/// delete the vault secret (the secret might still be used for an LLM
/// provider, e.g. the same OpenAI API key).
pub async fn delete_stt(
    State(state): State<Arc<AppState>>,
    auth: AuthToken,
) -> Result<Json<serde_json::Value>, RouteError> {
    check_scope(&auth.0, &TokenScope::SettingsWrite)?;

    let path = settings_path(&state.moxxy_home);
    let mut file_settings = SystemSettings::load(&path);
    file_settings.stt = None;
    file_settings.save(&path).map_err(|e| {
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "settings_save_failed",
            format!("failed to write settings.yaml: {e}"),
        )
    })?;

    state.set_stt(None, None);

    tracing::info!("STT configuration cleared via API");
    Ok(Json(serde_json::json!({ "enabled": false })))
}
