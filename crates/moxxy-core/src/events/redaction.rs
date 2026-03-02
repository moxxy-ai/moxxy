use serde_json::Value;

pub struct RedactionEngine;

impl RedactionEngine {
    pub fn redact(payload: Value, secrets: &[String]) -> (Value, Vec<String>) {
        let mut redacted_paths = Vec::new();
        let result = Self::redact_value(payload, secrets, String::new(), &mut redacted_paths);
        (result, redacted_paths)
    }

    fn redact_value(
        value: Value,
        secrets: &[String],
        path: String,
        redacted_paths: &mut Vec<String>,
    ) -> Value {
        match value {
            Value::String(s) => {
                if secrets.iter().any(|secret| s == *secret) {
                    redacted_paths.push(path);
                    Value::String("[REDACTED]".to_string())
                } else {
                    Value::String(s)
                }
            }
            Value::Object(map) => {
                let new_map = map
                    .into_iter()
                    .map(|(k, v)| {
                        let child_path = if path.is_empty() {
                            k.clone()
                        } else {
                            format!("{}.{}", path, k)
                        };
                        let new_v = Self::redact_value(v, secrets, child_path, redacted_paths);
                        (k, new_v)
                    })
                    .collect();
                Value::Object(new_map)
            }
            Value::Array(arr) => {
                let new_arr = arr
                    .into_iter()
                    .enumerate()
                    .map(|(i, v)| {
                        let child_path = format!("{}[{}]", path, i);
                        Self::redact_value(v, secrets, child_path, redacted_paths)
                    })
                    .collect();
                Value::Array(new_arr)
            }
            other => other,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redacts_secret_values_in_payload() {
        let payload = serde_json::json!({"key": "my-secret-value", "other": "safe"});
        let secrets = vec!["my-secret-value".to_string()];
        let (redacted, redaction_list) = RedactionEngine::redact(payload, &secrets);
        let key_val = redacted["key"].as_str().unwrap();
        assert_eq!(key_val, "[REDACTED]");
        assert_eq!(redacted["other"].as_str().unwrap(), "safe");
        assert!(!redaction_list.is_empty());
    }

    #[test]
    fn no_redactions_leaves_sensitive_false() {
        let payload = serde_json::json!({"key": "safe-value"});
        let secrets: Vec<String> = vec![];
        let (redacted, redaction_list) = RedactionEngine::redact(payload, &secrets);
        assert_eq!(redacted["key"].as_str().unwrap(), "safe-value");
        assert!(redaction_list.is_empty());
    }

    #[test]
    fn multiple_secrets_all_redacted() {
        let payload = serde_json::json!({"a": "secret1", "b": "secret2", "c": "safe"});
        let secrets = vec!["secret1".to_string(), "secret2".to_string()];
        let (redacted, _) = RedactionEngine::redact(payload, &secrets);
        assert_eq!(redacted["a"].as_str().unwrap(), "[REDACTED]");
        assert_eq!(redacted["b"].as_str().unwrap(), "[REDACTED]");
        assert_eq!(redacted["c"].as_str().unwrap(), "safe");
    }

    #[test]
    fn redaction_replaces_with_marker() {
        let payload = serde_json::json!({"token": "super-secret"});
        let secrets = vec!["super-secret".to_string()];
        let (redacted, _) = RedactionEngine::redact(payload, &secrets);
        assert_eq!(redacted["token"].as_str().unwrap(), "[REDACTED]");
    }
}

#[cfg(test)]
mod proptests {
    use super::*;
    use proptest::prelude::*;

    proptest! {
        #[test]
        fn redacted_output_never_contains_secret(
            secret in "[a-zA-Z0-9]{5,20}",
            key in "[a-z]{3,10}"
        ) {
            let payload = serde_json::json!({key.clone(): secret.clone()});
            let secrets = vec![secret.clone()];
            let (redacted, _) = RedactionEngine::redact(payload, &secrets);
            let output = serde_json::to_string(&redacted).unwrap();
            prop_assert!(!output.contains(&secret));
        }
    }
}
