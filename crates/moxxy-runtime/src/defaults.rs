use std::collections::HashMap;
use std::sync::LazyLock;

static RAW_YAML: &str = include_str!("default_allowlists.yaml");

static DEFAULTS: LazyLock<HashMap<String, Vec<String>>> = LazyLock::new(|| {
    serde_yaml::from_str(RAW_YAML).expect("default_allowlists.yaml must be valid YAML")
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

/// Merge defaults with DB allows, then remove denied entries.
/// Deny takes precedence over both defaults and custom allows.
pub fn merge_with_defaults_and_denials(
    db_allows: Vec<String>,
    db_denials: Vec<String>,
    list_type: &str,
) -> Vec<String> {
    let mut merged = merge_with_defaults(db_allows, list_type);
    if !db_denials.is_empty() {
        merged.retain(|entry| !db_denials.contains(entry));
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

    #[test]
    fn deny_removes_from_defaults() {
        let allows = vec![];
        let denials = vec!["git".to_string()];
        let merged = merge_with_defaults_and_denials(allows, denials, "shell_command");
        // "git" is a default but should be removed
        assert!(!merged.contains(&"git".to_string()));
        // Other defaults remain
        assert!(merged.contains(&"ls".to_string()));
    }

    #[test]
    fn deny_removes_custom_allows() {
        let allows = vec!["my-tool".to_string()];
        let denials = vec!["my-tool".to_string()];
        let merged = merge_with_defaults_and_denials(allows, denials, "shell_command");
        assert!(!merged.contains(&"my-tool".to_string()));
    }

    #[test]
    fn deny_nonexistent_is_noop() {
        let allows = vec![];
        let denials = vec!["nonexistent-tool".to_string()];
        let merged = merge_with_defaults_and_denials(allows, denials, "shell_command");
        let defaults = default_entries("shell_command");
        assert_eq!(merged.len(), defaults.len());
    }

    #[test]
    fn empty_denials_same_as_merge() {
        let allows = vec!["custom.io".to_string()];
        let merged_no_deny = merge_with_defaults(allows.clone(), "http_domain");
        let merged_with_deny = merge_with_defaults_and_denials(allows, vec![], "http_domain");
        assert_eq!(merged_no_deny, merged_with_deny);
    }
}
