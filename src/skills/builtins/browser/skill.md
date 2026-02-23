# Browser Skill

Unified browser automation skill. Supports lightweight HTTP fetch for static pages, web search, and full interactive Chromium automation for JS-heavy sites.

## Actions

### fetch (no browser needed, fast)
Fetches a URL and returns readable text. Best for articles, docs, static pages.
```
browser "fetch" "https://docs.python.org/3/library/asyncio.html"
```

### search (no browser needed, fast)
Searches the web using DuckDuckGo and returns top results with titles, links, and snippets.
```
browser "search" "rust async runtime comparison"
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

## Common Workflows

### Get latest news
```
browser "fetch" "https://news.google.com/"
```
Google News URLs are automatically converted to RSS feeds for clean, structured results. Works for:
- Top headlines: `browser "fetch" "https://news.google.com/"`
- Topic search: `browser "fetch" "https://news.google.com/search?q=AI&hl=en-US&gl=US"`

### Research a topic
1. `browser "search" "rust async runtime comparison"` -- find relevant pages
2. `browser "fetch" "<url>"` -- read the most relevant result

### Find recent articles about a subject
1. `browser "search" "latest articles about Donald Trump 2026"` -- search with recent date
2. `browser "fetch" "<url>"` for each interesting result to read the full article

### Get sports results
1. `browser "search" "Real Madrid vs Barcelona latest match result"` -- find score/recap
2. `browser "fetch" "<url>"` -- read the match report

### Compile a list of articles on a topic
1. `browser "search" "<topic> news"` -- get a list of results
2. `browser "fetch" "https://news.google.com/search?q=<topic>"` -- or use Google News for more results
3. `browser "fetch" "<url>"` -- read individual articles as needed

### Log into a website
1. `browser "navigate" "https://github.com/login"` -- get page snapshot
2. `browser "type" "3" "myuser"` -- type username into ref [3]
3. `browser "type" "5" "mypassword"` -- type password into ref [5]
4. `browser "click" "7"` -- click Sign In button ref [7]
5. `browser "snapshot"` -- see the result page

## Tips
- Use `search` to find information on the web before fetching specific pages
- Use `fetch` for reading articles/documentation (faster, no browser startup)
- Use `navigate` when you need JavaScript rendering or plan to interact with the page
- If `fetch` returns a warning about JavaScript or anti-bot protection, switch to `navigate`
- `fetch` will tell you if a page returned a 404 (don't retry) or 403 (use navigate instead)
- Snapshot refs change after every navigation or page mutation -- always re-snapshot before interacting
- The browser stays open between invocations for the same agent session
