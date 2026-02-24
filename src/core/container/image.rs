use anyhow::Result;
use tracing::info;

/// The pre-built agent_runtime.wasm binary, compiled from `agent_runtime/`
/// and embedded at compile time. This means users don't need the wasm32-wasip1
/// target installed - the image ships inside the `moxxy` binary.
static EMBEDDED_WASM_IMAGE: &[u8] = include_bytes!("../images/agent_runtime.wasm");

/// Ensure the WASM agent runtime image exists at `~/.moxxy/images/agent_runtime.wasm`.
/// If missing, extracts the embedded pre-built binary. Returns the path to the image.
pub async fn ensure_wasm_image() -> Result<std::path::PathBuf> {
    use crate::platform::{NativePlatform, Platform};
    let images_dir = NativePlatform::data_dir().join("images");
    let image_path = images_dir.join("agent_runtime.wasm");

    if !image_path.exists() {
        tokio::fs::create_dir_all(&images_dir).await?;
        tokio::fs::write(&image_path, EMBEDDED_WASM_IMAGE).await?;
        info!(
            "Provisioned WASM image ({} bytes) → {:?}",
            EMBEDDED_WASM_IMAGE.len(),
            image_path
        );
    }

    Ok(image_path)
}
