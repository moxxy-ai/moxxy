# HTTP Primitive

The `http.request` primitive makes HTTP requests to external services, with domain allowlists, timeouts, and response size limits.

## http.request

Make an HTTP request.

**Parameters**:

```json
{
  "method": "GET",
  "url": "https://api.example.com/data",
  "headers": {
    "Accept": "application/json"
  },
  "body": null,
  "timeout_seconds": 30
}
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `method` | string | Yes | -- | HTTP method: GET, POST, PUT, PATCH, DELETE, HEAD |
| `url` | string | Yes | -- | Target URL |
| `headers` | object | No | `{}` | Request headers |
| `body` | string | No | null | Request body |
| `timeout_seconds` | integer | No | 30 | Maximum wait time |

**Result**:

```json
{
  "status": 200,
  "headers": {
    "content-type": "application/json",
    "x-request-id": "abc123"
  },
  "body": "{\"data\": [1, 2, 3]}"
}
```

## Domain Allowlist

HTTP requests are restricted to a configured set of allowed domains. Requests to domains not in the allowlist are rejected with `PrimitiveError::AccessDenied`.

The allowlist is configured per agent or per skill. A typical allowlist might include:

```
api.github.com
api.openai.com
hooks.slack.com
```

Domain matching is exact (no wildcards by default). The protocol (http/https) is not part of the domain check.

## Limits

| Limit | Default | Description |
|-------|---------|-------------|
| Timeout | 30 seconds | Request times out |
| Response size | 5 MB | Response body truncated beyond this |

If the timeout is exceeded, `PrimitiveError::Timeout` is returned. If the response body exceeds the size limit, `PrimitiveError::SizeLimitExceeded` is returned.

## Authentication

For requests that need API keys or tokens, the agent should use vault-managed secrets. The primitive does not automatically inject credentials -- the LLM must include them in the request headers.

Example with an API key from the vault:

```json
{
  "method": "POST",
  "url": "https://api.example.com/generate",
  "headers": {
    "Authorization": "Bearer sk-abc123",
    "Content-Type": "application/json"
  },
  "body": "{\"prompt\": \"Hello\"}"
}
```

The vault integration for HTTP requests is handled at the agent level, where the secret is resolved and passed to the primitive via tool call arguments.

## Example Skill Declaration

```yaml
allowed_primitives:
  - http.request
  - memory.append
safety_notes: "HTTP access restricted to api.example.com."
```

## Security Considerations

- All requests pass through the domain allowlist before any network I/O occurs
- Response bodies are size-limited to prevent memory exhaustion
- Timeouts prevent hanging connections from blocking the agent
- Secret values in request headers are redacted in event payloads by the `RedactionEngine`
