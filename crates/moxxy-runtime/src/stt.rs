use async_trait::async_trait;
use moxxy_core::{SttError, SttProvider};
use reqwest::multipart;

/// OpenAI Whisper (or Whisper-compatible) speech-to-text backend.
pub struct WhisperProvider {
    client: reqwest::Client,
    api_base: String,
    api_key: String,
    model: String,
}

impl WhisperProvider {
    pub fn new(
        api_base: impl Into<String>,
        api_key: impl Into<String>,
        model: impl Into<String>,
    ) -> Self {
        Self {
            client: reqwest::Client::new(),
            api_base: api_base.into(),
            api_key: api_key.into(),
            model: model.into(),
        }
    }

    pub fn with_defaults(api_key: impl Into<String>) -> Self {
        Self::new("https://api.openai.com/v1", api_key, "whisper-1")
    }
}

#[async_trait]
impl SttProvider for WhisperProvider {
    async fn transcribe(
        &self,
        audio: &[u8],
        mime: &str,
        filename: &str,
    ) -> Result<String, SttError> {
        let file_part = multipart::Part::bytes(audio.to_vec())
            .file_name(filename.to_string())
            .mime_str(mime)
            .map_err(|e| SttError::Unsupported(format!("bad mime {mime}: {e}")))?;

        let form = multipart::Form::new()
            .part("file", file_part)
            .text("model", self.model.clone())
            .text("response_format", "text");

        let url = format!(
            "{}/audio/transcriptions",
            self.api_base.trim_end_matches('/')
        );

        let resp = self
            .client
            .post(&url)
            .bearer_auth(&self.api_key)
            .multipart(form)
            .send()
            .await
            .map_err(|e| SttError::Http(format!("request failed: {e}")))?;

        let status = resp.status();
        let body = resp
            .text()
            .await
            .map_err(|e| SttError::Http(format!("read body: {e}")))?;

        if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
            return Err(SttError::Auth(body));
        }
        if !status.is_success() {
            return Err(SttError::Http(format!("{status}: {body}")));
        }

        let text = body.trim().to_string();
        if text.is_empty() {
            return Err(SttError::Empty);
        }
        Ok(text)
    }

    fn name(&self) -> &str {
        "whisper"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::Router;
    use axum::extract::State;
    use axum::http::{HeaderMap, StatusCode};
    use axum::routing::post;
    use std::sync::Arc;
    use std::sync::Mutex as StdMutex;
    use tokio::net::TcpListener;

    /// What the fake Whisper server should return for the next request.
    #[derive(Clone)]
    struct MockConfig {
        status: StatusCode,
        body: String,
    }

    /// Captured data from the last request hitting the mock server.
    #[derive(Default, Clone, Debug)]
    struct CapturedRequest {
        authorization: Option<String>,
        content_type: Option<String>,
        body_len: usize,
        body_snippet: String,
    }

    #[derive(Clone)]
    struct MockState {
        cfg: Arc<StdMutex<MockConfig>>,
        captured: Arc<StdMutex<CapturedRequest>>,
    }

    async fn handler(
        State(state): State<MockState>,
        headers: HeaderMap,
        body: axum::body::Bytes,
    ) -> (StatusCode, String) {
        let body_bytes = body.to_vec();
        let snippet: String = body_bytes
            .iter()
            .take(512)
            .map(|b| *b as char)
            .collect::<String>();
        {
            let mut cap = state.captured.lock().unwrap();
            *cap = CapturedRequest {
                authorization: headers
                    .get("authorization")
                    .and_then(|v| v.to_str().ok())
                    .map(String::from),
                content_type: headers
                    .get("content-type")
                    .and_then(|v| v.to_str().ok())
                    .map(String::from),
                body_len: body_bytes.len(),
                body_snippet: snippet,
            };
        }
        let cfg = state.cfg.lock().unwrap().clone();
        (cfg.status, cfg.body)
    }

    /// Spin up a tiny axum server on a random port that pretends to be the
    /// Whisper endpoint. Returns `(base_url, captured_state)` — the server
    /// task runs until the whole test process exits.
    async fn spawn_mock(initial: MockConfig) -> (String, MockState) {
        let state = MockState {
            cfg: Arc::new(StdMutex::new(initial)),
            captured: Arc::new(StdMutex::new(CapturedRequest::default())),
        };
        let app = Router::new()
            .route("/audio/transcriptions", post(handler))
            .with_state(state.clone());

        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        (format!("http://{}", addr), state)
    }

    #[test]
    fn whisper_with_defaults_uses_openai_base() {
        let p = WhisperProvider::with_defaults("sk-abc");
        assert_eq!(p.api_base, "https://api.openai.com/v1");
        assert_eq!(p.model, "whisper-1");
        assert_eq!(p.api_key, "sk-abc");
        assert_eq!(p.name(), "whisper");
    }

    #[tokio::test]
    async fn whisper_success_returns_trimmed_transcript() {
        let (base, state) = spawn_mock(MockConfig {
            status: StatusCode::OK,
            body: "  hello world\n".into(),
        })
        .await;
        let provider = WhisperProvider::new(base, "sk-test", "whisper-1");
        let result = provider
            .transcribe(b"fake-wav-bytes", "audio/wav", "clip.wav")
            .await;
        assert_eq!(result.unwrap(), "hello world");

        let cap = state.captured.lock().unwrap().clone();
        assert_eq!(cap.authorization.as_deref(), Some("Bearer sk-test"));
        let ct = cap.content_type.expect("content-type");
        assert!(
            ct.starts_with("multipart/form-data"),
            "content-type was {ct}"
        );
        assert!(cap.body_len > 0);
        // The multipart body should mention the field names and filename.
        assert!(cap.body_snippet.contains("file"));
        assert!(cap.body_snippet.contains("clip.wav"));
        assert!(cap.body_snippet.contains("whisper-1"));
    }

    #[tokio::test]
    async fn whisper_401_maps_to_auth_error() {
        let (base, _state) = spawn_mock(MockConfig {
            status: StatusCode::UNAUTHORIZED,
            body: "bad key".into(),
        })
        .await;
        let provider = WhisperProvider::new(base, "sk-bad", "whisper-1");
        let err = provider
            .transcribe(b"audio", "audio/wav", "clip.wav")
            .await
            .unwrap_err();
        assert!(matches!(err, SttError::Auth(_)), "got {err:?}");
    }

    #[tokio::test]
    async fn whisper_403_maps_to_auth_error() {
        let (base, _state) = spawn_mock(MockConfig {
            status: StatusCode::FORBIDDEN,
            body: "nope".into(),
        })
        .await;
        let provider = WhisperProvider::new(base, "sk-bad", "whisper-1");
        let err = provider
            .transcribe(b"audio", "audio/wav", "clip.wav")
            .await
            .unwrap_err();
        assert!(matches!(err, SttError::Auth(_)), "got {err:?}");
    }

    #[tokio::test]
    async fn whisper_500_maps_to_http_error() {
        let (base, _state) = spawn_mock(MockConfig {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            body: "boom".into(),
        })
        .await;
        let provider = WhisperProvider::new(base, "sk-ok", "whisper-1");
        let err = provider
            .transcribe(b"audio", "audio/wav", "clip.wav")
            .await
            .unwrap_err();
        match err {
            SttError::Http(msg) => {
                assert!(msg.contains("500"), "msg was {msg}");
                assert!(msg.contains("boom"), "msg was {msg}");
            }
            other => panic!("expected Http, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn whisper_empty_body_maps_to_empty_error() {
        let (base, _state) = spawn_mock(MockConfig {
            status: StatusCode::OK,
            body: "   \n\n  ".into(),
        })
        .await;
        let provider = WhisperProvider::new(base, "sk-ok", "whisper-1");
        let err = provider
            .transcribe(b"audio", "audio/wav", "clip.wav")
            .await
            .unwrap_err();
        assert!(matches!(err, SttError::Empty), "got {err:?}");
    }

    #[tokio::test]
    async fn whisper_rejects_invalid_mime() {
        // No server spawned — the error should fire before any request is made.
        let provider = WhisperProvider::new("http://127.0.0.1:1", "sk", "whisper-1");
        let err = provider
            .transcribe(b"audio", "not/a valid mime!!", "clip.wav")
            .await
            .unwrap_err();
        assert!(matches!(err, SttError::Unsupported(_)), "got {err:?}");
    }

    #[tokio::test]
    async fn whisper_strips_trailing_slash_from_base() {
        let (base, state) = spawn_mock(MockConfig {
            status: StatusCode::OK,
            body: "ok".into(),
        })
        .await;
        // Append a trailing slash to ensure the URL builder handles it.
        let provider = WhisperProvider::new(format!("{}/", base), "sk", "whisper-1");
        let result = provider.transcribe(b"audio", "audio/wav", "clip.wav").await;
        assert_eq!(result.unwrap(), "ok");
        // Request still reached the handler (captured auth non-empty):
        let cap = state.captured.lock().unwrap().clone();
        assert!(cap.authorization.is_some());
    }
}
