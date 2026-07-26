---
name: browser
description: Observe and operate Moxxy Browser — the in-window browser shared live by the user and the agent.
triggers: ["moxxy browser", "what do you see in the browser", "what is open in the browser", "current browser tab", "first browser tab", "open the browser", "in the browser", "go to this site", "navigate to", "show me the page", "screenshot the page", "click the button on", "fill the form on", "browse to"]
allowed-tools: [browser_session, web_fetch]
---

# In-window browser

The desktop has a **Browser** pane that shows a live view of the SAME browser
your `browser_session` tool drives. When you navigate or click via
`browser_session`, the user sees it happen in that pane — and they can take over
(click, type, scroll, change the URL) on the same page.

## When to use it

- The user asks you to open, browse, or act on a web page they want to watch.
- The user refers to Moxxy Browser, its current/first/numbered tab, or asks
  what is visible there. This always means `browser_session`, never a desktop
  screenshot, AppleScript, Safari, or Chrome.
- You need to see a JS-heavy/interactive page (not just fetch HTML) — use
  `browser_session` (`observe`, `goto`, `click`, `type`, `select`, `upload`,
  `wait`, `press`, `scroll`, `drag`, history, tabs, `screenshot`). For a plain GET,
  `web_fetch` is lighter.
- You want to show the user a result visually rather than pasting text.

## How to use it well

- Start every visual task with `observe`. It returns the active tab, URL,
  viewport, and accessible elements with short refs such as `b4`.
- Prefer revision-bound refs for actions. Use viewport-relative points
  (`0..1000`) only for controls without useful semantics, such as a canvas.
- Follow `observe → act → observe`. Re-observe after navigation, a modal,
  submit, or `STALE_BROWSER_STATE`; never reuse an old ref blindly.
- Drive the page with `browser_session`; the Browser pane reflects it live.
- Use `wait` for a concrete result on dynamic pages, then `observe` again.
- Upload only a file path the user explicitly placed in scope.
- Use `observe: hybrid` or `screenshot` only when pixels materially matter.
  Semantic observation is cheaper and avoids capturing unrelated desktop apps.
- Never claim an action succeeded until the post-action observation confirms
  the expected page state.
- Navigation is restricted to public http(s) origins (loopback / private /
  metadata addresses are blocked); don't try to reach internal hosts.
- The user and you share one page and one signed-in profile. If they interact
  while you work, their input wins: observe again before continuing.
- Treat sends, purchases, publishing, deletion, and account changes as
  consequential actions. Stop at the final confirmation unless the user's
  current request explicitly authorizes it.
