//! Tauri commands — the JS-callable surface.

use tauri::State;

use crate::app_state::AppState;
use crate::desks::{Desk, DeskId};
use crate::error::AppResult;
use crate::sidecar::SidecarStatus;

#[tauri::command]
pub fn sidecar_status(state: State<'_, AppState>) -> SidecarStatus {
    state.sidecar.status()
}

#[tauri::command]
pub async fn desks_list(state: State<'_, AppState>) -> AppResult<Vec<Desk>> {
    state.desks.list().await
}

#[tauri::command]
pub async fn desks_upsert(state: State<'_, AppState>, desk: Desk) -> AppResult<()> {
    state.desks.upsert(desk).await
}

#[tauri::command]
pub async fn desks_remove(state: State<'_, AppState>, id: String) -> AppResult<()> {
    let id = DeskId::new(id)?;
    state.desks.remove(&id).await
}

#[tauri::command]
pub async fn desks_set_active(state: State<'_, AppState>, id: String) -> AppResult<()> {
    let id = DeskId::new(id)?;
    state.desks.set_active(&id).await
}

#[tauri::command]
pub async fn desks_active(state: State<'_, AppState>) -> AppResult<Option<DeskId>> {
    state.desks.active().await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app_state::AppState;
    use crate::desks::json_store::JsonDeskStore;
    use crate::sidecar::mock::MockSidecar;
    use crate::transport::mock::PairedTransport;
    use std::path::PathBuf;
    use std::sync::Arc;
    use tempfile::TempDir;

    fn state(tmp: &TempDir) -> AppState {
        let desks = Arc::new(JsonDeskStore::at(tmp.path().join("desks.json")));
        let sidecar = Arc::new(MockSidecar::with_status(SidecarStatus::Running));
        let (transport, _server) = PairedTransport::paired();
        AppState::for_testing(desks, sidecar, Arc::new(transport))
    }

    #[tokio::test]
    async fn end_to_end_desk_crud_through_traits() {
        let tmp = TempDir::new().unwrap();
        let state = state(&tmp);

        let d = Desk {
            id: DeskId::new("personal").unwrap(),
            name: "Personal".into(),
            dir: PathBuf::from("/tmp"),
            color: "#818cf8".into(),
            provider: None,
            model: None,
        };

        state.desks.upsert(d.clone()).await.unwrap();
        assert_eq!(state.desks.list().await.unwrap().len(), 1);

        state
            .desks
            .set_active(&DeskId::new("personal").unwrap())
            .await
            .unwrap();
        assert_eq!(
            state.desks.active().await.unwrap().unwrap().as_str(),
            "personal"
        );

        state
            .desks
            .remove(&DeskId::new("personal").unwrap())
            .await
            .unwrap();
        assert!(state.desks.list().await.unwrap().is_empty());
    }

    #[test]
    fn sidecar_status_returns_underlying_status() {
        let tmp = TempDir::new().unwrap();
        let state = state(&tmp);
        assert_eq!(state.sidecar.status(), SidecarStatus::Running);
    }
}
