use moxxy_runtime::PrimitiveError;

#[derive(Debug, thiserror::Error)]
pub enum PluginError {
    #[error("WASM module not found: {0}")]
    WasmNotFound(String),

    #[error("WASM compilation failed: {0}")]
    WasmCompilationFailed(String),

    #[error("invalid signature: {0}")]
    SignatureInvalid(String),

    #[error("signature missing")]
    SignatureMissing,

    #[error("fuel exhausted")]
    FuelExhausted,

    #[error("memory limit exceeded")]
    MemoryLimitExceeded,

    #[error("manifest error: {0}")]
    ManifestError(String),

    #[error("host function error: {0}")]
    HostFunctionError(String),

    #[error("runtime error: {0}")]
    RuntimeError(String),

    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
}

impl From<PluginError> for PrimitiveError {
    fn from(err: PluginError) -> Self {
        PrimitiveError::ExecutionFailed(err.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plugin_error_converts_to_primitive_error() {
        let pe = PluginError::FuelExhausted;
        let converted: PrimitiveError = pe.into();
        match converted {
            PrimitiveError::ExecutionFailed(msg) => {
                assert!(msg.contains("fuel exhausted"));
            }
            _ => panic!("expected ExecutionFailed"),
        }
    }

    #[test]
    fn plugin_error_display_messages() {
        assert_eq!(
            PluginError::WasmNotFound("test.wasm".into()).to_string(),
            "WASM module not found: test.wasm"
        );
        assert_eq!(
            PluginError::SignatureMissing.to_string(),
            "signature missing"
        );
        assert_eq!(PluginError::FuelExhausted.to_string(), "fuel exhausted");
        assert_eq!(
            PluginError::MemoryLimitExceeded.to_string(),
            "memory limit exceeded"
        );
    }

    #[test]
    fn plugin_error_from_io_error() {
        let io_err = std::io::Error::new(std::io::ErrorKind::NotFound, "file missing");
        let pe = PluginError::from(io_err);
        assert!(pe.to_string().contains("file missing"));
    }
}
