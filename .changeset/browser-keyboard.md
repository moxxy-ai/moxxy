---
'@moxxy/cli': minor
'@moxxy/desktop': minor
---

The agent can press keys, and the browser skill knows about the tools it has.

There was no way to send a key at all. An agent that needed Cmd+A to replace what
a field already held had nothing to reach for — and, watched live on Canva, it
went looking for a different browser rather than report that it could not press a
key. `browser_key` closes that: `Enter` to submit, `Escape` to dismiss, `Tab` to
move on, `Meta+a` then `Backspace` to empty a field. Modifiers combine with `+`.
The sidecar backend has had this since the beginning; only the desktop was
missing it, so a task's outcome depended on where it ran.

`Input.insertText` looked like the shorter road for a single character and is not
one: on its own, after the click that focused the field, it does nothing at all.
A key event carrying its `text` is what actually types, which is what this sends.

Getting a key to land took two more things, both found by watching it fail in the
app rather than in a test. A key only reaches the page when the `<webview>`
ELEMENT has focus in the window's DOM — and answering the approval prompt takes
that away, because answering means clicking in the app. `webContents.focus()`
from main does not fix it: the guest is a child of the embedder, so main now asks
the pane to focus the element and waits for it to say it has. And a hidden view
cannot take focus at all, so the pane brings the agent's tab forward first —
which is the honest thing anyway, since the agent is about to act there and this
browser exists so the user can watch that happen.

The cost is one deliberate side effect: pressing a key moves keyboard focus off
the composer and brings the agent's tab to the front. There is no way around it —
Chromium will not deliver a key to a page that is hidden and unfocused — so it is
scoped to `browser_key` alone. Reading and clicking leave focus where it is, and
a test says so.

The browser skill had drifted badly. It still described driving pages by CSS
selector and its `allowed-tools` listed only `browser_session`, so an agent that
loaded it was told to use none of the perception tools built since. It now
describes reading a page as an accessibility tree, acting by uid, and handing
over when a page needs a person — with `browser_session` named as the escape
hatch below that, which is where it belongs.

Nothing failed while the skill was stale, which is the point: a skill naming a
tool that does not exist is silently dropped, and one omitting a tool that does
exist just quietly withholds it. Two tests now tie the skill's `allowed-tools` to
what the plugin actually ships, in both directions.

Known limit, found and not yet chased: on canva.com the agent correctly stops at
the cookie banner and hands over, but the banner is pinned to the bottom of the
page viewport and that sits below the visible edge of the pane — so the person
has nothing to click and the hand-off repeats. Whether the `<webview>` is taller
than its container or the window was simply too short is unmeasured. Any page
with something fixed to the bottom is affected, not just Canva.
