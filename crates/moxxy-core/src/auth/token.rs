use moxxy_types::{TokenError, TokenScope};
use sha2::{Digest, Sha256};

pub struct IssuedToken {
    pub id: String,
    pub created_by: String,
    pub token_hash: String,
    pub scopes_json: String,
    pub created_at: String,
    pub expires_at: Option<String>,
    pub status: String,
}

pub struct ApiTokenService;

impl ApiTokenService {
    pub fn issue(
        created_by: &str,
        scopes: Vec<TokenScope>,
        ttl: Option<chrono::Duration>,
    ) -> (String, IssuedToken) {
        let id = uuid::Uuid::now_v7().to_string();
        let random_bytes: [u8; 32] = rand::random();
        let plaintext = format!("mox_{}", hex::encode(random_bytes));
        let token_hash = Self::hash(&plaintext);
        let scopes_json = serde_json::to_string(&scopes).unwrap();
        let now = chrono::Utc::now();
        let expires_at = ttl.map(|d| (now + d).to_rfc3339());

        let stored = IssuedToken {
            id,
            created_by: created_by.to_string(),
            token_hash,
            scopes_json,
            created_at: now.to_rfc3339(),
            expires_at,
            status: "active".to_string(),
        };
        (plaintext, stored)
    }

    pub fn hash(plaintext: &str) -> String {
        let mut hasher = Sha256::new();
        hasher.update(plaintext.as_bytes());
        hex::encode(hasher.finalize())
    }

    pub fn verify(plaintext: &str, stored: &IssuedToken) -> Result<(), TokenError> {
        if stored.status == "revoked" {
            return Err(TokenError::Revoked);
        }
        if let Some(ref exp) = stored.expires_at {
            let expires: chrono::DateTime<chrono::Utc> =
                exp.parse().map_err(|_| TokenError::InvalidToken)?;
            if expires < chrono::Utc::now() {
                return Err(TokenError::Expired);
            }
        }
        let computed_hash = Self::hash(plaintext);
        if computed_hash != stored.token_hash {
            return Err(TokenError::InvalidToken);
        }
        Ok(())
    }

    pub fn check_scopes(stored: &IssuedToken, required: &TokenScope) -> Result<(), TokenError> {
        let scopes: Vec<TokenScope> =
            serde_json::from_str(&stored.scopes_json).map_err(|_| TokenError::InvalidToken)?;
        if scopes.contains(required) {
            Ok(())
        } else {
            Err(TokenError::InsufficientScope(format!("{:?}", required)))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn issued_token_has_mox_prefix() {
        let (plaintext, _stored) =
            ApiTokenService::issue("test-user", vec![TokenScope::AgentsRead], None);
        assert!(plaintext.starts_with("mox_"));
    }

    #[test]
    fn issued_token_id_is_uuid_v7() {
        let (_plaintext, stored) =
            ApiTokenService::issue("test-user", vec![TokenScope::AgentsRead], None);
        assert!(uuid::Uuid::parse_str(&stored.id).is_ok());
    }

    #[test]
    fn verify_succeeds_for_correct_plaintext() {
        let (plaintext, stored) =
            ApiTokenService::issue("test-user", vec![TokenScope::AgentsRead], None);
        assert!(ApiTokenService::verify(&plaintext, &stored).is_ok());
    }

    #[test]
    fn verify_fails_for_wrong_plaintext() {
        let (_plaintext, stored) =
            ApiTokenService::issue("test-user", vec![TokenScope::AgentsRead], None);
        assert!(ApiTokenService::verify("mox_wrong_token", &stored).is_err());
    }

    #[test]
    fn verify_fails_for_revoked_token() {
        let (plaintext, mut stored) =
            ApiTokenService::issue("test-user", vec![TokenScope::AgentsRead], None);
        stored.status = "revoked".to_string();
        let err = ApiTokenService::verify(&plaintext, &stored).unwrap_err();
        assert!(matches!(err, TokenError::Revoked));
    }

    #[test]
    fn verify_fails_for_expired_token() {
        let (plaintext, mut stored) = ApiTokenService::issue(
            "test-user",
            vec![TokenScope::AgentsRead],
            Some(chrono::Duration::seconds(-1)),
        );
        stored.expires_at = Some((chrono::Utc::now() - chrono::Duration::seconds(60)).to_rfc3339());
        let err = ApiTokenService::verify(&plaintext, &stored).unwrap_err();
        assert!(matches!(err, TokenError::Expired));
    }

    #[test]
    fn verify_succeeds_for_no_ttl() {
        let (plaintext, stored) =
            ApiTokenService::issue("test-user", vec![TokenScope::AgentsRead], None);
        assert!(stored.expires_at.is_none());
        assert!(ApiTokenService::verify(&plaintext, &stored).is_ok());
    }

    #[test]
    fn scope_check_rejects_missing_scope() {
        let (_plaintext, stored) =
            ApiTokenService::issue("test-user", vec![TokenScope::AgentsRead], None);
        let err = ApiTokenService::check_scopes(&stored, &TokenScope::AgentsWrite).unwrap_err();
        assert!(matches!(err, TokenError::InsufficientScope(_)));
    }
}

#[cfg(test)]
mod proptests {
    use super::*;
    use proptest::prelude::*;

    proptest! {
        #[test]
        fn hash_is_deterministic(plaintext in "[a-zA-Z0-9]{10,50}") {
            let h1 = ApiTokenService::hash(&plaintext);
            let h2 = ApiTokenService::hash(&plaintext);
            prop_assert_eq!(h1, h2);
        }
    }
}
