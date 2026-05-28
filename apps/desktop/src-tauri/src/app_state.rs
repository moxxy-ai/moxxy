//! Composition root.

use std::sync::Arc;

use crate::desks::{json_store::JsonDeskStore, DeskStore};
use crate::sidecar::Sidecar;
use crate::transport::RunnerTransport;
#[cfg(not(test))]
use crate::transport::unix::UnixTransport;

#[derive(Clone)]
pub struct AppState {
    pub desks: Arc<dyn DeskStore>,
    pub sidecar: Arc<dyn Sidecar>,
    pub transport: Arc<dyn RunnerTransport>,
}

impl AppState {
    #[cfg(not(test))]
    pub fn production<R: tauri::Runtime>(
        _app: &tauri::AppHandle<R>,
    ) -> Result<Self, Box<dyn std::error::Error>> {
        use crate::sidecar::node::{NodeSidecar, NodeSidecarConfig};

        let home = dirs::home_dir().ok_or("home dir unavailable")?;
        let moxxy_dir = home.join(".moxxy");

        let desks = Arc::new(JsonDeskStore::at(moxxy_dir.join("desks.json")));

        let cli_entry = std::env::var("MOXXY_CLI_ENTRY")
            .unwrap_or_else(|_| "/usr/local/bin/moxxy-cli/bin.js".to_string());
        let sidecar = Arc::new(NodeSidecar::new(NodeSidecarConfig {
            cli_entry,
            ..Default::default()
        }));

        let transport: Arc<dyn RunnerTransport> = Arc::new(UnixTransport::default_path()?);

        Ok(Self {
            desks,
            sidecar,
            transport,
        })
    }

    #[cfg(test)]
    pub fn production<R: tauri::Runtime>(
        _app: &tauri::AppHandle<R>,
    ) -> Result<Self, Box<dyn std::error::Error>> {
        Err("AppState::production is not available in test builds".into())
    }

    pub fn for_testing(
        desks: Arc<dyn DeskStore>,
        sidecar: Arc<dyn Sidecar>,
        transport: Arc<dyn RunnerTransport>,
    ) -> Self {
        Self {
            desks,
            sidecar,
            transport,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::desks::{Desk, DeskId};
    use crate::sidecar::mock::MockSidecar;
    use crate::transport::mock::PairedTransport;
    use std::path::PathBuf;
    use tempfile::TempDir;

    fn fixture() -> (AppState, TempDir) {
        let tmp = TempDir::new().unwrap();
        let desks = Arc::new(JsonDeskStore::at(tmp.path().join("desks.json")));
        let sidecar = Arc::new(MockSidecar::new());
        let (transport, _server) = PairedTransport::paired();
        let transport: Arc<dyn RunnerTransport> = Arc::new(transport);
        (AppState::for_testing(desks, sidecar, transport), tmp)
    }

    #[tokio::test]
    async fn fixture_wires_capability_traits() {
        let (state, _tmp) = fixture();
        assert!(state.desks.list().await.unwrap().is_empty());
        let id = DeskId::new("test").unwrap();
        state
            .desks
            .upsert(Desk {
                id: id.clone(),
                name: "Test".into(),
                dir: PathBuf::from("/tmp"),
                color: "#fff".into(),
                provider: None,
                model: None,
            })
            .await
            .unwrap();
        assert_eq!(state.desks.list().await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn arc_clones_share_state() {
        let (state, _tmp) = fixture();
        let cloned = state.clone();
        let id = DeskId::new("a").unwrap();
        state
            .desks
            .upsert(Desk {
                id: id.clone(),
                name: "A".into(),
                dir: PathBuf::from("/tmp"),
                color: "#fff".into(),
                provider: None,
                model: None,
            })
            .await
            .unwrap();
        assert_eq!(cloned.desks.list().await.unwrap().len(), 1);
    }
}
