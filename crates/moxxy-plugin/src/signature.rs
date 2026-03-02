use ed25519_dalek::{Signature, Verifier, VerifyingKey};

use crate::PluginError;

pub struct SignatureVerifier {
    verifying_key: VerifyingKey,
}

impl SignatureVerifier {
    pub fn new(public_key_bytes: &[u8]) -> Result<Self, PluginError> {
        let key_bytes: [u8; 32] = public_key_bytes.try_into().map_err(|_| {
            PluginError::SignatureInvalid(format!(
                "public key must be 32 bytes, got {}",
                public_key_bytes.len()
            ))
        })?;
        let verifying_key = VerifyingKey::from_bytes(&key_bytes)
            .map_err(|e| PluginError::SignatureInvalid(e.to_string()))?;
        Ok(Self { verifying_key })
    }

    pub fn verify(&self, data: &[u8], signature: &[u8]) -> Result<(), PluginError> {
        let sig_bytes: [u8; 64] = signature.try_into().map_err(|_| {
            PluginError::SignatureInvalid(format!(
                "signature must be 64 bytes, got {}",
                signature.len()
            ))
        })?;
        let sig = Signature::from_bytes(&sig_bytes);
        self.verifying_key
            .verify(data, &sig)
            .map_err(|e| PluginError::SignatureInvalid(e.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};

    fn generate_keypair() -> (SigningKey, VerifyingKey) {
        let mut rng = rand::thread_rng();
        let signing_key = SigningKey::generate(&mut rng);
        let verifying_key = signing_key.verifying_key();
        (signing_key, verifying_key)
    }

    #[test]
    fn valid_signature_verifies() {
        let (signing_key, verifying_key) = generate_keypair();
        let data = b"hello plugin world";
        let signature = signing_key.sign(data);

        let verifier = SignatureVerifier::new(verifying_key.as_bytes()).unwrap();
        assert!(verifier.verify(data, &signature.to_bytes()).is_ok());
    }

    #[test]
    fn invalid_signature_rejected() {
        let (_signing_key, verifying_key) = generate_keypair();
        let data = b"hello plugin world";
        let bad_signature = [0u8; 64];

        let verifier = SignatureVerifier::new(verifying_key.as_bytes()).unwrap();
        assert!(verifier.verify(data, &bad_signature).is_err());
    }

    #[test]
    fn wrong_key_rejected() {
        let (signing_key, _verifying_key) = generate_keypair();
        let (_other_signing, other_verifying) = generate_keypair();

        let data = b"hello plugin world";
        let signature = signing_key.sign(data);

        let verifier = SignatureVerifier::new(other_verifying.as_bytes()).unwrap();
        assert!(verifier.verify(data, &signature.to_bytes()).is_err());
    }

    #[test]
    fn malformed_signature_returns_error() {
        let (_signing_key, verifying_key) = generate_keypair();
        let data = b"hello";
        let short_sig = [0u8; 32]; // too short

        let verifier = SignatureVerifier::new(verifying_key.as_bytes()).unwrap();
        let result = verifier.verify(data, &short_sig);
        assert!(result.is_err());
        match result.unwrap_err() {
            PluginError::SignatureInvalid(msg) => {
                assert!(msg.contains("64 bytes"));
            }
            other => panic!("expected SignatureInvalid, got {:?}", other),
        }
    }

    #[test]
    fn malformed_public_key_returns_error() {
        let bad_key = [0u8; 16]; // too short
        let result = SignatureVerifier::new(&bad_key);
        assert!(result.is_err());
    }
}
