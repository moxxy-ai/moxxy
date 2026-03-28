/// Render a template string by replacing `{{path.to.value}}` placeholders
/// with values from the given JSON `vars`.
///
/// Walks dotted paths into `serde_json::Value`. Missing keys are left as `{{key}}`.
/// Non-string values use `.to_string()`.
pub fn render_template(template: &str, vars: &serde_json::Value) -> String {
    let mut result = String::with_capacity(template.len());
    let mut rest = template;

    while let Some(start) = rest.find("{{") {
        result.push_str(&rest[..start]);
        let after_open = &rest[start + 2..];
        if let Some(end) = after_open.find("}}") {
            let key = after_open[..end].trim();
            let value = resolve_path(vars, key);
            match value {
                Some(serde_json::Value::String(s)) => result.push_str(s),
                Some(v) => result.push_str(&v.to_string()),
                None => {
                    result.push_str("{{");
                    result.push_str(key);
                    result.push_str("}}");
                }
            }
            rest = &after_open[end + 2..];
        } else {
            // No closing }}, just append the rest
            result.push_str(&rest[start..]);
            rest = "";
        }
    }
    result.push_str(rest);
    result
}

/// Resolve a dotted path (e.g. "body.pull_request.title") into a JSON value.
fn resolve_path<'a>(value: &'a serde_json::Value, path: &str) -> Option<&'a serde_json::Value> {
    let mut current = value;
    for segment in path.split('.') {
        current = current.get(segment)?;
    }
    Some(current)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn render_simple() {
        let vars = serde_json::json!({"name": "Alice"});
        assert_eq!(render_template("Hello {{name}}!", &vars), "Hello Alice!");
    }

    #[test]
    fn render_nested_path() {
        let vars = serde_json::json!({
            "body": {"pull_request": {"title": "Fix bug"}}
        });
        assert_eq!(
            render_template("PR: {{body.pull_request.title}}", &vars),
            "PR: Fix bug"
        );
    }

    #[test]
    fn render_missing_key_unchanged() {
        let vars = serde_json::json!({"name": "Bob"});
        assert_eq!(
            render_template("Hello {{missing}}!", &vars),
            "Hello {{missing}}!"
        );
    }

    #[test]
    fn render_no_placeholders() {
        let vars = serde_json::json!({});
        assert_eq!(render_template("plain text", &vars), "plain text");
    }

    #[test]
    fn render_multiple_placeholders() {
        let vars = serde_json::json!({"a": "1", "b": "2", "c": "3"});
        assert_eq!(render_template("{{a}}-{{b}}-{{c}}", &vars), "1-2-3");
    }

    #[test]
    fn render_non_string_value() {
        let vars = serde_json::json!({"count": 42, "active": true});
        assert_eq!(
            render_template("count={{count}} active={{active}}", &vars),
            "count=42 active=true"
        );
    }
}
