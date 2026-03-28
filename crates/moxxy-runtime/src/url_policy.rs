/// Extract the hostname from a URL, rejecting unsafe inputs.
/// Returns None if: non-http(s) scheme, credentials in URL, unparseable.
pub fn extract_host(raw_url: &str) -> Option<String> {
    let parsed = url::Url::parse(raw_url).ok()?;
    match parsed.scheme() {
        "http" | "https" => {}
        _ => return None,
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return None;
    }
    parsed.host_str().map(|h| h.to_lowercase())
}

/// Check if hostname is allowed against a list of allowed domains.
/// Supports exact match and subdomain match (dot-prefixed).
pub fn is_domain_allowed(hostname: &str, allowed_domains: &[String]) -> bool {
    let hostname = hostname.to_lowercase();
    allowed_domains.iter().any(|entry| {
        let entry = entry.to_lowercase();
        hostname == entry || hostname.ends_with(&format!(".{}", entry))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_host_basic_https() {
        assert_eq!(
            extract_host("https://example.com/path"),
            Some("example.com".into())
        );
    }

    #[test]
    fn extract_host_with_port() {
        assert_eq!(
            extract_host("http://localhost:8080/api"),
            Some("localhost".into())
        );
    }

    #[test]
    fn extract_host_blocks_credentials() {
        assert_eq!(extract_host("https://attacker.com@github.com/"), None);
    }

    #[test]
    fn extract_host_blocks_credentials_with_password() {
        assert_eq!(extract_host("https://user:pass@github.com/"), None);
    }

    #[test]
    fn extract_host_blocks_non_http_scheme() {
        assert_eq!(extract_host("ftp://example.com"), None);
    }

    #[test]
    fn extract_host_blocks_file_scheme() {
        assert_eq!(extract_host("file:///etc/passwd"), None);
    }

    #[test]
    fn extract_host_blocks_unparseable() {
        assert_eq!(extract_host("not a url"), None);
    }

    #[test]
    fn extract_host_lowercases() {
        assert_eq!(
            extract_host("https://EXAMPLE.COM/path"),
            Some("example.com".into())
        );
    }

    #[test]
    fn is_domain_allowed_subdomain_match() {
        let allowed = vec!["github.com".to_string()];
        assert!(is_domain_allowed("api.github.com", &allowed));
    }

    #[test]
    fn is_domain_allowed_anti_suffix() {
        let allowed = vec!["github.com".to_string()];
        assert!(!is_domain_allowed("evilgithub.com", &allowed));
    }

    #[test]
    fn is_domain_allowed_exact_match() {
        let allowed = vec!["github.com".to_string()];
        assert!(is_domain_allowed("github.com", &allowed));
    }

    #[test]
    fn is_domain_allowed_empty_list() {
        let allowed: Vec<String> = vec![];
        assert!(!is_domain_allowed("example.com", &allowed));
    }

    #[test]
    fn is_domain_allowed_case_insensitive() {
        let allowed = vec!["GitHub.COM".to_string()];
        assert!(is_domain_allowed("github.com", &allowed));
        assert!(is_domain_allowed("API.GitHub.COM", &allowed));
    }

    #[test]
    fn is_domain_allowed_deep_subdomain() {
        let allowed = vec!["github.com".to_string()];
        assert!(is_domain_allowed("a.b.c.github.com", &allowed));
    }
}
