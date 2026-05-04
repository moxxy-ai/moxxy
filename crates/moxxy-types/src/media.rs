use serde::{Deserialize, Serialize};

/// Broad media classes accepted by channel transports.
///
/// V1 understands images end-to-end. The other variants are part of the stable
/// attachment envelope so future document/audio/video support does not require
/// changing the channel/run interfaces again.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MediaKind {
    Image,
    Document,
    Audio,
    Voice,
    Video,
    Unknown,
}

/// A stored media attachment passed from channels into runtime/provider layers.
///
/// `local_path` points to a file under `$MOXXY_HOME/media/...`; it must never be
/// a provider URL containing secrets, and raw bytes/base64 must not be stored in
/// this structure.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MediaAttachmentRef {
    pub id: String,
    pub kind: MediaKind,
    pub mime: String,
    pub filename: String,
    pub local_path: String,
    pub size_bytes: u64,
    pub sha256: String,
    #[serde(default)]
    pub source: serde_json::Value,
}
