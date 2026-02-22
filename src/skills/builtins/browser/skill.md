# Browser Skill

Unified browser automation skill. Supports lightweight HTTP fetch for static pages and full interactive Chromium automation for JS-heavy sites.

## Actions

### fetch (no browser needed, fast)
Fetches a URL and returns readable text. Best for articles, docs, static pages.
```
browser "fetch" "https://docs.python.org/3/library/asyncio.html"
```

### navigate (launches browser)
Opens a URL in a managed Chromium instance and returns an accessibility snapshot with numbered element refs.
```
browser "navigate" "https://example.com"
```

### snapshot
Returns the current page's accessibility snapshot with numbered refs.
```
browser "snapshot"
```

### click
Clicks an element by its snapshot ref number.
```
browser "click" "5"
```

### type
Types text into an element by its snapshot ref number.
```
browser "type" "3" "user@example.com"
```

### screenshot
Takes a screenshot and saves it to a temp file. Returns the file path.
```
browser "screenshot"
```

### scroll
Scrolls the page. Direction: "up", "down", or a ref number to scroll to.
```
browser "scroll" "down"
```

### evaluate
Executes JavaScript on the page and returns the result.
```
browser "evaluate" "document.title"
```

### back / forward
Navigate browser history.
```
browser "back"
browser "forward"
```

### tabs
Lists all open browser tabs.
```
browser "tabs"
```

### close
Closes the current tab (switches to previous tab if available).
```
browser "close"
```

### wait
Waits for a specified number of milliseconds.
```
browser "wait" "2000"
```

## Workflow Example

1. `browser "navigate" "https://github.com/login"` -- get page snapshot
2. `browser "type" "3" "myuser"` -- type username into ref [3]
3. `browser "type" "5" "mypassword"` -- type password into ref [5]
4. `browser "click" "7"` -- click Sign In button ref [7]
5. `browser "snapshot"` -- see the result page

## Tips
- Use `fetch` for reading articles/documentation (faster, no browser startup)
- Use `navigate` when you need JavaScript rendering or plan to interact with the page
- Snapshot refs change after every navigation or page mutation -- always re-snapshot before interacting
- The browser stays open between invocations for the same agent session
