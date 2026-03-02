use std::collections::HashMap;
use std::sync::LazyLock;

static RAW_JSON: &str = include_str!("default_allowlists.json");

static DEFAULTS: LazyLock<HashMap<String, Vec<String>>> = LazyLock::new(|| {
    serde_json::from_str(RAW_JSON).expect("default_allowlists.json must be valid JSON")
});

/// Return the built-in default entries for a given list type (e.g. "http_domain", "shell_command").
/// Returns an empty slice if no defaults exist for the given type.
pub fn default_entries(list_type: &str) -> &[String] {
    DEFAULTS.get(list_type).map(|v| v.as_slice()).unwrap_or(&[])
}

/// Merge default entries with DB entries, deduplicating.
pub fn merge_with_defaults(db_entries: Vec<String>, list_type: &str) -> Vec<String> {
    let defaults = default_entries(list_type);
    if defaults.is_empty() {
        return db_entries;
    }

    let mut merged = defaults.to_vec();
    for entry in db_entries {
        if !merged.contains(&entry) {
            merged.push(entry);
        }
    }
    merged
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_load_http_domains() {
        let domains = default_entries("http_domain");
        assert!(!domains.is_empty());
        assert!(domains.contains(&"github.com".to_string()));
        assert!(domains.contains(&"api.github.com".to_string()));
        assert!(domains.contains(&"stackoverflow.com".to_string()));
    }

    #[test]
    fn defaults_load_shell_commands() {
        let commands = default_entries("shell_command");
        assert!(!commands.is_empty());
        assert!(commands.contains(&"git".to_string()));
        assert!(commands.contains(&"ls".to_string()));
        assert!(commands.contains(&"cargo".to_string()));
    }

    #[test]
    fn defaults_unknown_type_returns_empty() {
        let entries = default_entries("nonexistent");
        assert!(entries.is_empty());
    }

    #[test]
    fn merge_deduplicates() {
        let db = vec!["github.com".to_string(), "custom.io".to_string()];
        let merged = merge_with_defaults(db, "http_domain");
        // "github.com" appears only once (from defaults)
        let count = merged.iter().filter(|d| *d == "github.com").count();
        assert_eq!(count, 1);
        // "custom.io" is appended
        assert!(merged.contains(&"custom.io".to_string()));
    }

    #[test]
    fn merge_with_no_defaults_returns_db_entries() {
        let db = vec!["foo".to_string()];
        let merged = merge_with_defaults(db.clone(), "nonexistent");
        assert_eq!(merged, db);
    }
}
