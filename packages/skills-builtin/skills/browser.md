---
name: browser
description: Open an in-window browser the user can watch, then navigate, click, and screenshot it for them.
triggers: ["open the browser", "in the browser", "go to this site", "navigate to", "show me the page", "screenshot the page", "click the button on", "fill the form on", "browse to"]
allowed-tools: [browser_session, web_fetch]
---

# In-window browser

The desktop has a **Browser** pane that shows a live view of the SAME browser
your `browser_session` tool drives. When you navigate or click via
`browser_session`, the user sees it happen in that pane — and they can take over
(click, type, scroll, change the URL) on the same page.

## When to use it

- The user asks you to open, browse, or act on a web page they want to watch.
- You need to see a JS-heavy/interactive page (not just fetch HTML) — use
  `browser_session` (`goto`, `click`, `fill`, `screenshot`). For a plain GET,
  `web_fetch` is lighter.
- You want to show the user a result visually rather than pasting text.

## How to use it well

- Drive the page with `browser_session`; the Browser pane reflects it live, so
  you don't need to narrate every pixel — just say what you're doing.
- Take a `screenshot` when a visual check matters (did the page load, did the
  form submit) or when the user asks to see it.
- Navigation is restricted to public http(s) origins (loopback / private /
  metadata addresses are blocked); don't try to reach internal hosts.
- The user and you share one page — if they've navigated somewhere, read the
  current state (`url`, `text`, `screenshot`) before acting.
