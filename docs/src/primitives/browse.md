# Browse Primitives

Browse primitives allow agents to fetch web pages and extract structured data from HTML content.

## browse.fetch

Fetch a web page and return its content.

**Parameters**:

```json
{
  "url": "https://docs.example.com/api",
  "selector": "main.content",
  "timeout_seconds": 30
}
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `url` | string | Yes | -- | URL to fetch |
| `selector` | string | No | null | CSS selector to extract a portion of the page |
| `timeout_seconds` | integer | No | 30 | Maximum fetch time |

**Result**:

```json
{
  "url": "https://docs.example.com/api",
  "status": 200,
  "content": "<main class=\"content\">...</main>",
  "content_type": "text/html",
  "size": 4200
}
```

When a CSS `selector` is provided, only the matching portion of the page is returned. This is useful for extracting article content while discarding navigation, headers, and footers.

**Security**:
- Domain allowlist is enforced before any network request
- Timeout prevents hanging connections
- Response size is capped at 10 MB

## browse.extract

Extract structured data from HTML content using CSS selectors. This is a pure parsing operation -- no network requests are made.

**Parameters**:

```json
{
  "html": "<ul><li>Item 1</li><li>Item 2</li></ul>",
  "selector": "li",
  "attribute": null
}
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `html` | string | Yes | -- | HTML content to parse |
| `selector` | string | Yes | -- | CSS selector to match |
| `attribute` | string | No | null | Extract an attribute instead of text content |

**Result**:

```json
{
  "matches": [
    {"text": "Item 1", "html": "<li>Item 1</li>"},
    {"text": "Item 2", "html": "<li>Item 2</li>"}
  ],
  "count": 2
}
```

When `attribute` is specified, the result includes the attribute value:

```json
{
  "selector": "a",
  "attribute": "href"
}
```

Result:

```json
{
  "matches": [
    {"text": "Link text", "html": "<a href=\"/page\">Link text</a>", "href": "/page"}
  ]
}
```

**Security**: Since `browse.extract` operates on in-memory HTML strings, it does not make network requests and does not require domain allowlist checks.

## Typical Workflow

Agents commonly use fetch and extract together:

1. `browse.fetch` to download a page (with optional selector to narrow scope)
2. `browse.extract` to pull structured data from the fetched HTML
3. `memory.append` to save findings

Example skill declaration:

```yaml
allowed_primitives:
  - browse.fetch
  - browse.extract
  - memory.append
safety_notes: "Web browsing restricted to allowed domains. No write access."
```

## Domain Allowlist

`browse.fetch` shares the same domain allowlist mechanism as `http.request`. The domain must be in the agent's allowed list before any network I/O occurs.

Requests to disallowed domains return `PrimitiveError::AccessDenied` with the domain name in the error message.

## Size Limits

| Limit | Value | Description |
|-------|-------|-------------|
| Fetch response | 10 MB | Maximum page size for `browse.fetch` |
| Fetch timeout | 30 seconds | Maximum time for HTTP response |
| Extract input | No limit | `browse.extract` parses in-memory strings |
