---
name: browser
description: Drive the in-window browser the user is watching — read a page as an accessibility tree, act by uid or in runs of named steps, work from a picture, and hand over when a page needs a person.
triggers: ["open the browser", "in the browser", "go to this site", "navigate to", "show me the page", "screenshot the page", "click the button on", "fill the form on", "browse to", "search for", "on the website", "log in to", "sign in to", "book a", "order a", "design a"]
label: Moxxy Browser
aliases: [moxxy_browser, przegladarka]
disallowed-tools: ["computer_*"]
allowed-tools: [browser_snapshot, browser_click, browser_type, browser_key, browser_batch, browser_navigate, browser_tabs, browser_capture, browser_history, browser_await_human, browser_select, browser_scroll, browser_hover, browser_wait, browser_dialog, browser_allow_site, browser_point, browser_upload, browser_run, browser_session, web_fetch]
---

# The in-window browser

The desktop has a **Browser** pane showing a real Chromium view. It is the same
page you drive — not a picture of one — so the user watches you work and can take
over on the spot. It carries their signed-in profile, which is why you must never
treat it as a throwaway browser.

Outside the desktop — `moxxy` in a terminal, or a runner on its own — the same
tools drive a browser of your own with no window. Everything below works the
same there, with two differences: nobody watches it or can take it over, and it
has none of the user's logins.

**For a web page, use these tools, not the computer** — unless the user names
another browser or app (Arc, Safari, Chrome…) or writes `@computer_use`. Then
the work belongs in that app on their screen, through the computer tools, and
this pane stays out of it. `@moxxy_browser` is the opposite call: this pane,
and the computer tools are off for that request. Otherwise do not reach for macOS control, a screenshot
of the screen, or another browser: this one is where the user watches you work.

## Be quick

Every call is a round trip the user waits for. The pages are not the slow part;
looking again is.

- **Go straight to the page.** Open the URL you know. When you have to guess one
  (a search page, a product path), guess once; if it is wrong, use the site's own
  search or links rather than guessing again.
- **Never open the page you are already on.** The snapshot names the URL; a
  second `browser_navigate` to it only reloads it and throws your uids away.
- **Read once, broadly, then narrow.** One snapshot shows the whole page. Do not
  scroll through it or capture it piece by piece to find something the tree
  already lists.
- **Trust one clear signal.** An action's answer says what it set off (navigated,
  a dialog, a tab it opened, what a field shows now). When it says the thing
  happened, carry on; do not read the page again just to see it twice.
- **Plan the steps you know and send them together** — as one `browser_run` when
  it is among your tools, otherwise as a `browser_batch` or as several calls in
  one response.
- **Finish the task yourself.** The user asked you, not themselves: a search
  that lands on the wrong article, a disambiguation page, a list on two pages —
  each is one more step for you. Follow the link the page offers; never ask the
  user to click something you can click.
- **Answer from the whole list.** For "the cheapest", "the newest", "how many",
  compare every item the page lists (and the next page, when there is one)
  before you answer — not the first one that looks right.

## How to read a page

`browser_snapshot` gives you the page as an accessibility tree — every element
that can be acted on, each with a `[uid]`. That is the form you act on: you name
a uid, not a CSS selector and not a coordinate.

- After the first read of a tab you get **only what changed** since it. A uid
  keeps meaning the same element, so everything not listed is still as you last
  saw it. Ask for `full: true` when you have lost your bearings — it costs far
  more, so not by default.
- After a navigation the uids are gone with the page they described, and the next
  read is a whole tree again.
- If the answer is "unchanged since your last snapshot", the page really has not
  moved. Do something, then look again; reading twice in a row tells you nothing
  and is not free.

## How to act

- `browser_click` — press something, by uid.
- `browser_type` — put text into a field, by uid; it replaces what the field
  held, and `submit: true` presses Enter after it (the usual way to search).
- `browser_select` — choose an option of a native list by its label.
- `browser_key` — the things a click and a string cannot do: `Escape` to dismiss,
  `Tab` to move on. The key lands wherever the page has focus.
- `browser_navigate` — go to a URL. Public http(s) only; internal hosts are
  refused.
- `browser_history` — back, forward, reload.

Every one of these takes a `tab_id`. Pass the one the snapshot gave you; omit it
only when you mean "whatever tab is in front".

When an action is refused, the answer says why — disabled, covered by a banner,
not drawn because a menu is closed. Fix that (close the banner, open the menu)
instead of repeating the same call.

## Runs of steps

When `browser_run` is among your tools (the user has Jev on), it is the way to
act — even for a single click — instead of `browser_click`, `browser_type`,
`browser_select` and `browser_batch`: name each element in words as it reads on
the page ("Add to basket button of the second book", "Search field"), send
every step you already know in one call, and give `expect` to the steps that
open or change something ("the basket says 1 item"). It finds the elements on
the live page itself, so you need not read the page first when you know what
is on it. It finds each element by its name, from what worked
on this site before, or by asking Jev, checks every `expect`, and stops at the
first step that does not work, saying why. Its answer ends with the page as it
is now — continue from there; do not read it again.

Use the single tools for what a run reports as not done, for what has no name
on the page, and when a step depends on reading something first (which book is
cheapest, what a search found). When `browser_run` is not among your tools, do
not look for it: act with the single tools.

## Allowing a site

The user allows a site once, and you act there without asking again. Before the
first action on a site — opening one of its pages, a click, typing — call
`browser_allow_site` with the site and a one-line reason, in the same response
as that action. Every snapshot lists the sites already allowed: never ask for
one of those again. An action on a site nobody allowed comes back refused with
the site to ask for: ask, then repeat the step. Reading a page never needs it.
If the user declines, do not act on that site; say what you would have done.

## Doing several things at once

`browser_batch` runs a sequence of uid actions and reads the page **once**, at
the end. Filling a form as five separate calls pays for five reads of it.
Whenever you already know the next few steps — fill these fields, press Enter,
then look — put them in one batch. Steps stop at the first failure, and the
error names which step it was.

## Below the fold, behind a menu, still loading

- `browser_scroll` when what you need is further down a long list, or a list
  loads more as you scroll. Clicking and typing scroll to their element on
  their own, so never scroll just to reach a uid you already have.
- `browser_hover` for a menu that opens when the pointer is over it; then read
  what appeared.
- `browser_wait` for something slower than a page load — a search still running,
  an upload, a spinner — by the text that will appear (or, with `gone: true`,
  disappear). Every action already waits for the page to settle.

## Tabs

`browser_tabs` lists, opens, switches and closes them. Every snapshot already
names the open tabs, so you never have to ask which page you are on. A link that
opens a new tab says so, with the new `tab_id`. The tab you are working in is
yours — the user switching tabs in the pane does not move your aim.

## Where nothing has a name: work from a picture

A `<canvas>` app (a drawing board, a map, a game) shows things the accessibility
tree cannot name. There, `browser_capture` without a uid returns a named picture
of the viewport (`v1`, `v2`, …) in the page's pixels, and `browser_point` clicks,
double-clicks, drags along a path, scrolls, presses a key or types **at places in
that picture**. Each point answers with a fresh picture: point at the newest one.
A point is refused, with nothing done, when the page navigated, scrolled or
looks different at that place since the picture — capture again and aim anew.
Keyboard shortcuts of the app ("r" for a rectangle tool) go through
`browser_point` with `key`. Prefer uids whenever the tree has the element.

## When the page wants a person

A cookie banner, a CAPTCHA, a sign-in form: the snapshot says so under
**Needs you**. Do not click through any of them.

- The consent is the user's to give. Do not accept or reject it for them.
- The CAPTCHA is theirs to solve. Do not try, and do not look for a way around it.
- The password is theirs to type. Never type one, and **never ask them to tell
  you a credential** — they enter it themselves.

Call `browser_await_human` with a plain sentence saying what the page wants. You
stop reading the page while they deal with it. Afterwards, take a fresh snapshot
and confirm from the page itself that it worked — "I clicked Done" is not
evidence of anything.

In a browser with no window, `browser_await_human` answers that nobody can do it
there. Stop acting on that page and tell the user what it needs; they can finish
it in the Moxxy desktop app or in their own browser.

A file field is filled with `browser_upload` (paths on this computer; the user
is asked each time) — never click the button that opens the system's file
dialog, which you cannot answer.

## When the user takes over

On the desktop the user can take the browser at any moment — by pressing on the page, typing
into it, or Take over. From then on every action is refused with "The user has
taken over the browser". Do not retry, and do not reach the page another way
(`browser_session`, a script, the computer tools): tell them what you were about
to do and wait. They hand it back with Resume or by sending a new message; then
read the page afresh, since they may have changed it.

## The escape hatch

`browser_session` still drives the same page by CSS selector and can run an
expression in it. Use it when the accessibility tree genuinely does not describe
what you need. It is below the tools above, not beside them.

For a plain GET with no page to watch, `web_fetch` is lighter than all of this.
