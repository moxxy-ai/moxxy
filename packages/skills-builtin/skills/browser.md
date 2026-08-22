---
name: browser
description: Drive the in-window browser the user is watching — read a page as an accessibility tree, click and type by uid, manage tabs, and hand over when a page needs a person.
triggers: ["open the browser", "in the browser", "go to this site", "navigate to", "show me the page", "screenshot the page", "click the button on", "fill the form on", "browse to", "search for", "on the website", "log in to", "sign in to", "book a", "order a", "design a"]
allowed-tools: [browser_snapshot, browser_click, browser_type, browser_key, browser_batch, browser_navigate, browser_tabs, browser_capture, browser_history, browser_await_human, browser_session, web_fetch]
---

# The in-window browser

The desktop has a **Browser** pane showing a real Chromium view. It is the same
page you drive — not a picture of one — so the user watches you work and can take
over on the spot. It carries their signed-in profile, which is why you must never
treat it as a throwaway browser.

**Use these tools, not the computer.** Do not reach for macOS control, a
screenshot of the screen, or any other browser to visit a web page. This browser
is the one the user is looking at; anything else acts somewhere they cannot see.

## How to read a page

`browser_snapshot` gives you the page as an accessibility tree — every element
that can be acted on, each with a `[uid]`. That is the form you act on: you name
a uid, not a CSS selector and not a coordinate.

- Read before acting, and again after anything that changes the page.
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
- `browser_type` — put text into a field, by uid.
- `browser_key` — the things a click and a string cannot do: `Enter` to submit,
  `Escape` to dismiss, `Tab` to move on, and `Meta+a` then `Backspace` to empty a
  field that already has something in it. The key lands wherever the page has
  focus, so click the field first.
- `browser_navigate` — go to a URL. Public http(s) only; internal hosts are
  refused.
- `browser_history` — back, forward, reload.

Every one of these takes a `tab_id`. Pass the one the snapshot gave you; omit it
only when you mean "whatever tab is in front".

## Doing several things at once

`browser_batch` runs a sequence and reads the page **once**, at the end. Reading
a large page costs thousands of tokens, so filling a form as five separate calls
pays for five reads of it. Whenever you already know the next few steps — fill
these fields, press Enter, then look — put them in one batch.

Steps stop at the first failure, so a sequence never carries on against a page
that did not do what you expected, and the error names which step it was. One
approval covers the whole thing, and it shows every step.

## Tabs

`browser_tabs` lists, opens, switches and closes them. Every snapshot already
names the open tabs, so you never have to ask which page you are on. The tab you
are working in is yours — the user switching tabs in the pane does not move your
aim.

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

## Seeing it

`browser_capture` takes a picture, and cropping to a uid is far cheaper than a
whole viewport. Reach for it when the accessibility tree is empty where something
is clearly visible — a `<canvas>` app, a chart, a rendered document — not as a
first look.

## The escape hatch

`browser_session` still drives the same page by CSS selector and can run an
expression in it. Use it when the accessibility tree genuinely does not describe
what you need. It is below the tools above, not beside them.

For a plain GET with no page to watch, `web_fetch` is lighter than all of this.
