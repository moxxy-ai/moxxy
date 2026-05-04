use moxxy_types::{MediaAttachmentRef, MediaKind};
use sha2::{Digest, Sha256};
use std::path::PathBuf;

const MAX_MEDIA_BYTES: usize = 25 * 1024 * 1024;

pub struct StoreMediaInput<'a> {
    pub kind: MediaKind,
    pub bytes: &'a [u8],
    pub mime: &'a str,
    pub filename: &'a str,
    pub source: serde_json::Value,
}

#[derive(Debug, Clone)]
pub struct MediaStore {
    moxxy_home: PathBuf,
}

impl MediaStore {
    pub fn new(moxxy_home: PathBuf) -> Self {
        Self { moxxy_home }
    }

    pub fn store_bytes(&self, input: StoreMediaInput<'_>) -> Result<MediaAttachmentRef, String> {
        if input.bytes.is_empty() {
            return Err("media payload is empty".into());
        }
        if input.bytes.len() > MAX_MEDIA_BYTES {
            return Err(format!(
                "media payload too large: {} bytes exceeds {} bytes",
                input.bytes.len(),
                MAX_MEDIA_BYTES
            ));
        }

        let detected_mime = detect_mime(input.bytes);
        let declared_mime = normalize_mime(input.mime);
        if input.kind == MediaKind::Image && detected_mime.is_none() {
            return Err("image payload has invalid magic bytes".into());
        }
        if input.kind == MediaKind::Document
            && detected_mime.is_none()
            && !looks_like_text_document(input.bytes)
        {
            return Err("document payload has unsupported or invalid bytes".into());
        }
        let mime = resolve_media_mime(&input.kind, detected_mime, declared_mime, input.bytes)
            .or_else(|| {
                if input.kind == MediaKind::Document && looks_like_text_document(input.bytes) {
                    Some("text/plain")
                } else {
                    None
                }
            })
            .unwrap_or("application/octet-stream")
            .to_string();
        if input.kind == MediaKind::Image && !mime.starts_with("image/") {
            return Err(format!("image payload resolved to non-image mime: {mime}"));
        }
        if input.kind == MediaKind::Document && !is_supported_document_mime(&mime) {
            return Err(format!("unsupported document mime: {mime}"));
        }

        let mut hasher = Sha256::new();
        hasher.update(input.bytes);
        let sha256 = hex::encode(hasher.finalize());
        let ext = extension_for_mime(&mime)
            .map(str::to_string)
            .or_else(|| extension_for_filename(input.filename));
        let file_name = match ext {
            Some(ext) => format!("{sha256}.{ext}"),
            None => sha256.clone(),
        };

        let source_dir = source_dir_name(&input.source);
        let month = chrono::Utc::now().format("%Y-%m").to_string();
        let dir = self
            .moxxy_home
            .join("media")
            .join("inbound")
            .join(source_dir)
            .join(month);
        std::fs::create_dir_all(&dir)
            .map_err(|e| format!("create media directory {}: {e}", dir.display()))?;
        let path = dir.join(file_name);
        if !path.exists() {
            std::fs::write(&path, input.bytes)
                .map_err(|e| format!("write media file {}: {e}", path.display()))?;
        }

        Ok(MediaAttachmentRef {
            id: format!("media_{sha256}"),
            kind: input.kind,
            mime,
            filename: sanitize_filename(input.filename),
            local_path: path.to_string_lossy().into_owned(),
            size_bytes: input.bytes.len() as u64,
            sha256,
            source: input.source,
        })
    }
}

fn resolve_media_mime(
    kind: &MediaKind,
    detected_mime: Option<&'static str>,
    declared_mime: Option<&'static str>,
    bytes: &[u8],
) -> Option<&'static str> {
    if kind == &MediaKind::Document && looks_like_zip_container(bytes) {
        if let Some(mime) = declared_mime.filter(|mime| is_ooxml_mime(mime)) {
            return Some(mime);
        }
    }

    detected_mime.or(declared_mime)
}

fn detect_mime(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        return Some("image/jpeg");
    }
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Some("image/png");
    }
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        return Some("image/gif");
    }
    if bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP" {
        return Some("image/webp");
    }
    if bytes.starts_with(b"%PDF-") {
        return Some("application/pdf");
    }
    if looks_like_zip_container(bytes) {
        return Some("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    }
    None
}

fn normalize_mime(mime: &str) -> Option<&'static str> {
    match mime.trim().to_ascii_lowercase().as_str() {
        "image/jpeg" | "image/jpg" => Some("image/jpeg"),
        "image/png" => Some("image/png"),
        "image/gif" => Some("image/gif"),
        "image/webp" => Some("image/webp"),
        "application/pdf" => Some("application/pdf"),
        "text/plain" => Some("text/plain"),
        "text/markdown" => Some("text/markdown"),
        "text/csv" => Some("text/csv"),
        "application/json" => Some("application/json"),
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document" => {
            Some("application/vnd.openxmlformats-officedocument.wordprocessingml.document")
        }
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" => {
            Some("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        }
        "application/vnd.openxmlformats-officedocument.presentationml.presentation" => {
            Some("application/vnd.openxmlformats-officedocument.presentationml.presentation")
        }
        "audio/ogg" => Some("audio/ogg"),
        "audio/mpeg" => Some("audio/mpeg"),
        "video/mp4" => Some("video/mp4"),
        _ => None,
    }
}

fn extension_for_mime(mime: &str) -> Option<&'static str> {
    match mime {
        "image/jpeg" => Some("jpg"),
        "image/png" => Some("png"),
        "image/gif" => Some("gif"),
        "image/webp" => Some("webp"),
        "application/pdf" => Some("pdf"),
        "text/plain" => Some("txt"),
        "text/markdown" => Some("md"),
        "text/csv" => Some("csv"),
        "application/json" => Some("json"),
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document" => Some("docx"),
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" => Some("xlsx"),
        "application/vnd.openxmlformats-officedocument.presentationml.presentation" => Some("pptx"),
        "audio/ogg" => Some("ogg"),
        "audio/mpeg" => Some("mp3"),
        "video/mp4" => Some("mp4"),
        _ => None,
    }
}

fn looks_like_text_document(bytes: &[u8]) -> bool {
    !bytes.contains(&0) && std::str::from_utf8(bytes).is_ok()
}

fn is_supported_document_mime(mime: &str) -> bool {
    matches!(
        mime,
        "application/pdf"
            | "text/plain"
            | "text/markdown"
            | "text/csv"
            | "application/json"
            | "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            | "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            | "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    )
}

fn is_ooxml_mime(mime: &str) -> bool {
    matches!(
        mime,
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            | "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            | "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    )
}

fn looks_like_zip_container(bytes: &[u8]) -> bool {
    bytes.starts_with(b"PK\x03\x04")
        || bytes.starts_with(b"PK\x05\x06")
        || bytes.starts_with(b"PK\x07\x08")
}

fn extension_for_filename(filename: &str) -> Option<String> {
    let ext = std::path::Path::new(filename)
        .extension()
        .and_then(|s| s.to_str())?
        .to_ascii_lowercase();
    if ext.chars().all(|c| c.is_ascii_alphanumeric()) && (1..=8).contains(&ext.len()) {
        Some(ext)
    } else {
        None
    }
}

fn source_dir_name(source: &serde_json::Value) -> String {
    source
        .get("channel")
        .or_else(|| source.get("transport"))
        .and_then(|v| v.as_str())
        .filter(|s| !s.trim().is_empty())
        .map(sanitize_path_segment)
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "unknown".into())
}

fn sanitize_path_segment(value: &str) -> String {
    let sanitized: String = value
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    sanitized.trim_matches('_').chars().take(64).collect()
}

fn sanitize_filename(filename: &str) -> String {
    let basename = std::path::Path::new(filename)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("attachment");
    let sanitized: String = basename
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | ' ') {
                c
            } else {
                '_'
            }
        })
        .collect();
    let trimmed = sanitized.trim();
    if trimmed.is_empty() || trimmed == "." || trimmed == ".." {
        "attachment".into()
    } else {
        trimmed.chars().take(160).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use moxxy_types::MediaKind;

    fn jpeg_bytes() -> Vec<u8> {
        vec![0xff, 0xd8, 0xff, 0xe0, b'M', b'O', b'X', b'X', b'Y']
    }

    #[test]
    fn media_store_writes_image_under_moxxy_home_media() {
        let tmp = tempfile::TempDir::new().unwrap();
        let store = MediaStore::new(tmp.path().to_path_buf());

        let saved = store
            .store_bytes(StoreMediaInput {
                kind: MediaKind::Image,
                bytes: &jpeg_bytes(),
                mime: "image/jpeg",
                filename: "photo.jpg",
                source: serde_json::json!({"channel": "telegram"}),
            })
            .unwrap();

        assert!(
            saved.local_path.starts_with(
                tmp.path()
                    .join("media")
                    .join("inbound")
                    .join("telegram")
                    .to_str()
                    .unwrap()
            )
        );
        assert!(std::path::Path::new(&saved.local_path).is_file());
        assert_eq!(saved.mime, "image/jpeg");
        assert_eq!(saved.kind, MediaKind::Image);
    }

    #[test]
    fn media_store_deduplicates_by_sha256() {
        let tmp = tempfile::TempDir::new().unwrap();
        let store = MediaStore::new(tmp.path().to_path_buf());
        let bytes = jpeg_bytes();

        let first = store
            .store_bytes(StoreMediaInput {
                kind: MediaKind::Image,
                bytes: &bytes,
                mime: "image/jpeg",
                filename: "photo.jpg",
                source: serde_json::json!({"channel": "telegram"}),
            })
            .unwrap();
        let second = store
            .store_bytes(StoreMediaInput {
                kind: MediaKind::Image,
                bytes: &bytes,
                mime: "image/jpeg",
                filename: "renamed.jpg",
                source: serde_json::json!({"channel": "telegram"}),
            })
            .unwrap();

        assert_eq!(first.sha256, second.sha256);
        assert_eq!(first.local_path, second.local_path);
    }

    #[test]
    fn media_store_rejects_image_with_invalid_magic_bytes() {
        let tmp = tempfile::TempDir::new().unwrap();
        let store = MediaStore::new(tmp.path().to_path_buf());

        let err = store
            .store_bytes(StoreMediaInput {
                kind: MediaKind::Image,
                bytes: b"not actually an image",
                mime: "image/jpeg",
                filename: "photo.jpg",
                source: serde_json::json!({"channel": "telegram"}),
            })
            .unwrap_err();

        assert!(err.contains("magic bytes"), "got: {err}");
    }

    #[test]
    fn media_store_writes_pdf_document_under_moxxy_home_media() {
        let tmp = tempfile::TempDir::new().unwrap();
        let store = MediaStore::new(tmp.path().to_path_buf());
        let pdf = b"%PDF-1.7\n1 0 obj\n<<>>\nendobj\n";

        let saved = store
            .store_bytes(StoreMediaInput {
                kind: MediaKind::Document,
                bytes: pdf,
                mime: "application/pdf",
                filename: "brief.pdf",
                source: serde_json::json!({"channel": "telegram"}),
            })
            .unwrap();

        assert_eq!(saved.kind, MediaKind::Document);
        assert_eq!(saved.mime, "application/pdf");
        assert!(saved.local_path.ends_with(".pdf"));
        assert!(std::path::Path::new(&saved.local_path).is_file());
    }

    #[test]
    fn media_store_rejects_invalid_document_bytes() {
        let tmp = tempfile::TempDir::new().unwrap();
        let store = MediaStore::new(tmp.path().to_path_buf());

        let err = store
            .store_bytes(StoreMediaInput {
                kind: MediaKind::Document,
                bytes: &[0, 159, 146, 150],
                mime: "application/pdf",
                filename: "bad.pdf",
                source: serde_json::json!({"channel": "telegram"}),
            })
            .unwrap_err();

        assert!(err.contains("unsupported or invalid"), "got: {err}");
    }

    #[test]
    fn media_store_preserves_declared_ooxml_document_mime() {
        let tmp = tempfile::TempDir::new().unwrap();
        let store = MediaStore::new(tmp.path().to_path_buf());
        let xlsx = b"PK\x03\x04fake xlsx zip container";

        let saved = store
            .store_bytes(StoreMediaInput {
                kind: MediaKind::Document,
                bytes: xlsx,
                mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                filename: "prices.xlsx",
                source: serde_json::json!({"channel": "telegram"}),
            })
            .unwrap();

        assert_eq!(
            saved.mime,
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        );
        assert!(saved.local_path.ends_with(".xlsx"));
    }
}
