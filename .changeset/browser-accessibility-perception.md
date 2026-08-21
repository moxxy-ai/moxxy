---
'@moxxy/cli': minor
'@moxxy/desktop': minor
---

Browser: accessibility-first perception, named tabs, and a much cheaper live view.

The agent now reads pages as an accessibility tree where every interactive
element carries a `[uid]` it can act on, instead of choosing between a wall of
`innerText` and a screenshot — neither of which it could click, which is why it
had to guess CSS selectors. New tools: `browser_snapshot`, `browser_click`,
`browser_type`, `browser_navigate`, `browser_tabs`. `browser_session` remains
as the escape hatch for CSS selectors and in-page `eval`.

Every snapshot carries the open-tab list (so the agent never has to ask which
page it is on), frames page content as untrusted data, and redacts
credential-shaped field values before they reach the model.

Acting on a `uid` from before a navigation now fails with a clear "take a fresh
snapshot" rather than clicking whatever occupies that position now.

The live preview no longer streams while nobody is watching, skips frames
identical to the last one, and renders at CSS scale rather than 2x — the same
view at roughly a quarter of the pixels.

Desktop: the browser pane now hosts pages in real Chromium views the window
composites (Electron `<webview>`s main hardens at attach time), instead of
receiving a JPEG several times a second. Tabs stay mounted so a background page
keeps its state, and the agent drives those same views over CDP through a
private, token-authenticated socket — so the human and the agent look at one
document, which is what makes watching the agent work, and taking over from it,
possible at all. Outside the desktop (CLI, headless, a remote runner) the tools
fall back to the Playwright sidecar unchanged.

`browser_capture` restores region capture on top of CDP: pass a uid and it crops
to that element rather than shipping a whole viewport.

The agent can now stop and hand the browser to you. `browser_await_human` puts a
banner on the pane saying what it needs — a sign-in, a one-time code, a consent
screen — and blocks until you click Done or Skip. While it is pending the agent
is not reading the page, so nothing you type during a hand-off is snapshotted,
logged, or sent to the model, and every uid from before the pause is invalidated
afterwards. Tab changes the agent makes are pushed to the pane, so the tab strip
can no longer disagree with the page in front of you. `browser_history` gives
back/forward/reload the same treatment.
