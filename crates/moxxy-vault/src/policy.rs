use moxxy_storage::VaultGrantRow;
use moxxy_types::VaultError;

pub struct VaultPolicy;

impl VaultPolicy {
    pub fn check_grant(
        grants: &[VaultGrantRow],
        agent_id: &str,
        secret_ref_id: &str,
    ) -> Result<(), VaultError> {
        let has_active = grants.iter().any(|g| {
            g.agent_id == agent_id && g.secret_ref_id == secret_ref_id && g.revoked_at.is_none()
        });
        if has_active {
            Ok(())
        } else {
            Err(VaultError::AccessDenied)
        }
    }
}
