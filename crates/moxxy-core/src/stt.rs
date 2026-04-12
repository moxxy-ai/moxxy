use async_trait::async_trait;
use thiserror::Error;

/// Errors that may occur during speech-to-text transcription.
#[derive(Debug, Error)]
pub enum SttError {
    #[error("stt auth error: {0}")]
    Auth(String),
    #[error("stt http error: {0}")]
    Http(String),
    #[error("stt unsupported: {0}")]
    Unsupported(String),
    #[error("stt returned empty transcript")]
    Empty,
}

/// Abstraction over a speech-to-text backend (Whisper, Groq, local, ...).
///
/// Implementations live in `moxxy-runtime` (which owns the HTTP stack); this
/// trait is defined in `moxxy-core` so the `moxxy-channel` crate can depend
/// on it without pulling the full runtime.
#[async_trait]
pub trait SttProvider: Send + Sync {
    /// Transcribe the supplied audio bytes.
    async fn transcribe(
        &self,
        audio: &[u8],
        mime: &str,
        filename: &str,
    ) -> Result<String, SttError>;

    /// Short name for logging / event emission (e.g. `"whisper"`).
    fn name(&self) -> &str;
}
