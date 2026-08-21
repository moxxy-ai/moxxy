---
'@moxxy/cli': patch
'@moxxy/desktop': patch
---

The agent's browser tools all drive the page you are looking at.

`browser_session` built its own call bound straight to the Playwright child,
skipping the backend switch every other browser tool goes through. Inside the
desktop that launched a SECOND Chromium — none of the signed-in profile,
invisible to everyone — and the agent worked in that one while the person
watched the real page sit still. Asked to play a YouTube video, the agent
reported that it had, and was telling the truth about a browser nobody could
see. It now routes through the same switch as the rest of the plugin, and the
Playwright child is only reached for when it is the backend answering.

The desktop bridge grew the verbs that switch then delivers: `click` and `fill`
by CSS selector, `text`, `html`, `eval` and `screenshot`. Selector lookup
retries while the page settles rather than failing on the first miss, and `fill`
selects what a field already held so the insert replaces instead of appending —
by selection, not by assigning `.value`, which is the only form a
framework-controlled input sees. The sidecar's `close` is a no-op here: that
browser is the user's, on screen, holding their logins.

The pane's active tab and the tab the agent is working on are now separate. They
were the same value, so a person clicking a tab mid-task silently re-aimed the
agent's next un-targeted command at the page they had just opened. The agent's
aim moves only when the agent names a tab or opens one, and is forgotten when
that tab closes.
