# Browse Network Skill

Lightweight web page fetcher that extracts readable text content from URLs.
Uses only Python standard library — no external dependencies or browser installations required.

## Usage

Provide the URL to fetch as the first argument.

```bash
browse_network "https://example.com"
browse_network "https://docs.python.org/3/library/urllib.html"
```

Returns page content as readable text with basic Markdown formatting (headings, links, lists, code blocks).
Hard-capped at ~15,000 characters to protect context window.

## Limitations

- Does NOT execute JavaScript — use `web_crawler` for JS-heavy single-page applications
- Best for: articles, documentation, static pages, API docs, Wikipedia
