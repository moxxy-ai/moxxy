use async_trait::async_trait;

#[derive(Debug, thiserror::Error)]
pub enum EmbeddingError {
    #[error("Embedding service error: {0}")]
    ServiceError(String),
}

#[async_trait]
pub trait EmbeddingService: Send + Sync {
    fn dimension(&self) -> usize;
    async fn embed(&self, text: &str) -> Result<Vec<f32>, EmbeddingError>;
    async fn embed_batch(&self, texts: &[&str]) -> Result<Vec<Vec<f32>>, EmbeddingError>;
}

/// Mock embedding service that generates deterministic vectors from SHA-256 hashes
pub struct MockEmbeddingService;

impl Default for MockEmbeddingService {
    fn default() -> Self {
        Self
    }
}

impl MockEmbeddingService {
    pub fn new() -> Self {
        Self
    }
}

#[async_trait]
impl EmbeddingService for MockEmbeddingService {
    fn dimension(&self) -> usize {
        384
    }

    async fn embed(&self, text: &str) -> Result<Vec<f32>, EmbeddingError> {
        use sha2::{Digest, Sha256};
        let hash = Sha256::digest(text.as_bytes());
        let mut vec = Vec::with_capacity(384);
        // Cycle through hash bytes to fill 384 dimensions
        for i in 0..384 {
            let byte = hash[i % 32];
            // Normalize to [-1.0, 1.0]
            vec.push((byte as f32 / 127.5) - 1.0);
        }
        Ok(vec)
    }

    async fn embed_batch(&self, texts: &[&str]) -> Result<Vec<Vec<f32>>, EmbeddingError> {
        let mut results = Vec::with_capacity(texts.len());
        for text in texts {
            results.push(self.embed(text).await?);
        }
        Ok(results)
    }
}

/// Convert f32 vector to little-endian byte blob for SQLite storage
pub fn embedding_to_bytes(embedding: &[f32]) -> Vec<u8> {
    embedding.iter().flat_map(|f| f.to_le_bytes()).collect()
}

/// Convert little-endian byte blob back to f32 vector
pub fn bytes_to_embedding(bytes: &[u8]) -> Vec<f32> {
    bytes
        .chunks_exact(4)
        .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn mock_embedding_deterministic() {
        let svc = MockEmbeddingService::new();
        let v1 = svc.embed("hello world").await.unwrap();
        let v2 = svc.embed("hello world").await.unwrap();
        assert_eq!(v1, v2);
    }

    #[tokio::test]
    async fn mock_embedding_correct_dimension() {
        let svc = MockEmbeddingService::new();
        let v = svc.embed("test input").await.unwrap();
        assert_eq!(v.len(), 384);
        assert_eq!(svc.dimension(), 384);
    }

    #[tokio::test]
    async fn mock_embedding_different_inputs_differ() {
        let svc = MockEmbeddingService::new();
        let v1 = svc.embed("input A").await.unwrap();
        let v2 = svc.embed("input B").await.unwrap();
        assert_ne!(v1, v2);
    }

    #[test]
    fn embedding_to_bytes_roundtrip() {
        let original: Vec<f32> = vec![1.0, -1.0, 0.5, -0.5, 0.0, 2.71];
        let bytes = embedding_to_bytes(&original);
        let decoded = bytes_to_embedding(&bytes);
        assert_eq!(original, decoded);
    }
}
