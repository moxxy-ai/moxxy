# Moxxy Browser

The desktop's Browser pane is a real Chromium view (a `<webview>`) that the
agent drives and the user watches. Every click the agent makes is a click on
that view, so the user can see it happen and take over at any moment. Outside
the desktop — the terminal UI, `moxxy -p` — the same tools drive a headless
Playwright browser instead; that backend is unchanged by this work.

- [Baseline](baseline.md) — what the browser could and could not do before.
- [Results by stage](results.md) — the same tasks after each stage.

## How an action works (desktop)

The main process drives the view over CDP (`packages/desktop-host/src/browser/`).
An action on an element named by a `uid` from the last snapshot goes the way a
person's would, and every step that can go wrong says so:

1. **The tab comes to the front.** A view behind another tab takes no input at
   all, so the agent's tab is shown before anything is pressed — which is also
   what lets the user see it.
2. **The element is scrolled into view** and its place read from the page.
3. **Checks**: a disabled control is refused; if something covers the element
   (a banner, a dialog, a menu), the press is refused with the name of what is
   in the way. A menu held open by the pointer is given the chance to close
   first.
4. **The pointer moves there and presses.** The agent's own pointer — the
   same arrowhead as the Computer Use cursor — glides to the element, and the
   press goes out once the pane reports it has arrived (at most 250 ms of
   glide; at once with reduced motion or when the pane is not drawing it). A
   ring marks the press. The page is asked whether it felt the press; a press
   that reached nothing is an error, not a success.
5. **The page settles**: a navigation is waited for until it loads (up to 3 s,
   reported as `loading` if it has not), otherwise until the DOM goes quiet
   (up to 1.5 s).
6. **The result says what happened**: `navigated`, a `dialog`, a tab the page
   `opened`, or what a field `value` now shows.

## Tools

On both backends: `browser_snapshot`, `browser_click`, `browser_type`,
`browser_key`, `browser_batch`, `browser_navigate`, `browser_tabs`,
`browser_capture`, `browser_history`, `browser_await_human`.

Only on the desktop:

| Tool | What it does | Asks first |
|---|---|---|
| `browser_allow_site` | Asks the user to allow a site for the rest of the conversation | yes |
| `browser_select` | Picks an option in a native `<select>` by its label or value | no (site consent) |
| `browser_dialog` | Accepts or dismisses a `confirm` / `prompt` (an `alert` is accepted by the click itself and quoted) | yes |
| `browser_scroll` | Scrolls the page, or the part a uid sits in, by screens; says whether it moved | no |
| `browser_hover` | Moves the pointer over an element, for hover menus | no |
| `browser_wait` | Waits for a text to appear or go away; `met: false` means not yet | no |

On the desktop, `browser_type` replaces what a field holds (it no longer
appends) and takes `submit: true` to press Enter afterwards.

## Allowing a site

On the desktop the person allows a **site** once, and the agent then acts there
without a prompt per action. Click, type, keys, batch, navigate, history, tabs
and select ask nothing on their own; instead the desktop refuses any of them
that would land on a site the conversation has not allowed, and the refusal
names the site and tells the agent to call `browser_allow_site`. That call is
the one prompt: the user sees the site and the agent's reason.

- **What a site is:** the host, lower-cased, without `www.`. Allowing
  `canva.com` covers `www.canva.com` and `static.canva.com`, not
  `canva.com.evil.net`; an IP address covers only itself; a lone label such as
  `com` cannot be allowed.
- **What is judged:** a navigation (`goto`, a new tab with a URL) by where it
  goes; every other action by the page it acts on. Reading, capturing,
  scrolling, hovering and waiting go anywhere.
- **Still asked every time:** `browser_dialog` (a confirm usually guards
  something final) and `browser_session`, whose calls carry no sites.
- **Where it lives:** the approved `browser_allow_site` result in the session
  log, so every client of the conversation sees the same sites; each desktop
  call carries them (`sites`), folded from the log by `sitesFromLog`. A policy
  rule in `~/.moxxy/permissions.json` still wins, and the terminal UI keeps its
  prompt per action.

## Taking the browser back

While a turn is working in the browser, the pane shows a bar: **Take over**
and **Stop**. The person takes over with the button, or simply by pressing on
the page or typing into it — moving the pointer over the page or scrolling to
look does not count, and neither do the agent's own presses. From then on every
action the agent attempts (click, type, navigate, keys, tabs, scripts) is
refused with a message saying the user has the browser; reading the page still
works. The bar then offers **Resume**. Sending a new message is also a go-ahead:
a new turn drives again. Answering a hand-off hands the browser back too.
**Stop** takes the browser over and ends the running turn.

Who drives lives in one place, the desktop's `BrowserHost`, and reaches the
pane through `browser.tabsChanged`; each agent call names its turn (`turn_id`),
which is how a new request is told apart from the one that was stopped.

## Pages that need a person

A snapshot flags a page that is waiting for the user — a cookie choice, a
CAPTCHA, a sign-in — and the agent hands over with `browser_await_human`
instead of answering it. A link to a cookie *policy* is not a cookie choice,
and a form that merely has a password field among others is not a sign-in;
neither stops the agent any more. A password field is still never typed into.

## Frames, dialogs, new tabs

- **Frames** are read into the snapshot under their `Iframe` node, from the
  same site and from other sites (each of those through its own CDP session),
  and their elements can be clicked and typed into like any other.
- **Dialogs**: an `alert` is accepted and its text returned with the click; a
  `confirm` or `prompt` stays open, the page is frozen until it is answered,
  and every other action on that tab says to answer it with `browser_dialog`.
- **New windows** (`target=_blank`, `window.open`) open as tabs in the pane,
  and the click that opened one returns its `tab_id`.

## Trying it

`apps/desktop/scripts/browser-trial/` runs the agent, or a scripted probe,
against a window with the desktop's real browser host — see the header of
`run.mjs`. Never point it at the real `~/.moxxy`; pass a throwaway `MOXXY_HOME`.
