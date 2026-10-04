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
2. **The element is scrolled into view** and its place read from the page —
   once the document has been parsed. A navigation answers while the page is
   still loading, before its styles apply, and an element measured then is
   somewhere else a moment later; `browser_navigate` therefore returns once the
   new document is parsed (up to 5 s), and a press waits the same way.
3. **Checks**: a disabled control is refused; if something covers the element
   (a banner, a dialog, a menu), the press is refused with the name of what is
   in the way. A menu held open by the pointer is given the chance to close
   first.
4. **The pointer moves there and presses.** The agent's own pointer — the
   same arrowhead as the Computer Use cursor — glides to the element, and the
   press goes out once the pane reports it has arrived (at most 250 ms of
   glide; at once with reduced motion or when the pane is not drawing it). If
   the element moved while the pointer was on its way, the pointer follows it
   (up to three glides) and presses where it is now. A ring marks the press. The page is asked whether it felt the press; a press
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
| `browser_point` | Clicks, double/right-clicks, moves, drags, scrolls, presses a key or types at a place in the latest viewport picture | no (site consent) |
| `browser_upload` | Gives a file field local files, as the file dialog would | yes, every time |
| `browser_run` | Carries out a run of steps named in words, finding each element and checking each `expect` with Jev — only with a TypeSafe key and Jev on | no (site consent) |

On the desktop, `browser_type` replaces what a field holds (it no longer
appends) and takes `submit: true` to press Enter afterwards.

## Working by picture

A canvas app (Excalidraw, a map, a chart) shows things the accessibility tree
cannot name. There the agent takes `browser_capture` without a uid: on the
desktop that is a **view** — `v1`, `v2`, … — a picture of the viewport in CSS
pixels (not the screen's: a Retina screen would make it four times the cost),
answered with its size. `browser_point` then acts at x, y of that picture:
click, double_click, right_click, move, drag along a `path`, scroll, key, type.

A point is refused, with nothing done, when the picture no longer describes
the page: it is not the latest view of the tab, the page navigated or scrolled
since, or the pixels around the target look different now (a few stray pixels
are not a change). Every point answers with a fresh view, which is the one to
use next, so working on a canvas costs no extra captures. `key` exists on
`browser_point` for the same reason: picking a drawing tool usually changes the
canvas, and the picture that comes back already shows it.

`browser_upload` hands a file field files from this computer through
`DOM.setFileInputFiles`. The uid may be the input itself, a label for it, a
button with one inside, or any element on a page that has exactly one file
input — which covers the usual hidden input behind an "Add attachment" button.
It always asks first, since the files leave the computer.

## Runs of steps (Jev)

With a TypeSafe key in the vault and Jev switched on (Settings → Jev — the same
switch as for Computer Use), the agent gets `browser_run`: it plans the steps it
already knows and sends them in one call, each naming its element in words as
it reads on the page, with `expect` on the steps that open or change something:

```json
{ "goal": "open the second Travel book",
  "steps": [
    { "do": "click", "target": "Travel", "expect": "a list of Travel books" },
    { "do": "click", "target": "the title link of the second book", "expect": "the page of one book with its price" } ] }
```

A step is `click`, `type` (`text`, `submit`), `select` (`option`), `key` or
`hover`. For each one the desktop serves the page as Jev reads it — the
elements one can act on under the uids the other tools use, and the page as
text (`tree` on the bridge, which leaves the agent's own reads untouched) — and
code finds the element, in this order:

1. **What worked on this site before**, from `~/.moxxy/browser-use/learned/`
   (one file per site, the same memory format as Computer Use);
2. **its name**, when exactly one element is called what the step says;
3. **the focused field**, for a `type` step without a target;
4. **Jev** (TypeSafe's System One model), asked which element the words mean.
   When the one it picks cannot be pressed, the next likely one is tried.

Each `expect` is checked by two Jev yes/no questions in one request — the
same request that finds the next step's element: one over what the step
changed (what the browser said it set off — a navigation, an answered dialog, a
new tab — and the lines of the page that appeared and went away), one over the
page as it is now. Either one seeing it is enough: something expected to
disappear shows only among what went away. (Given as two named lists, Jev read
a closed banner as gone at 0.9; given as lines marked + and −, at 0.3.)

A run takes from each step only what its kind uses: strict providers fill every
field, so a click arrives with an `option` and a key with a `target`, and both
are dropped. It stops at the first step whose element is not found or cannot be
acted on (**failed**), or whose expectation was not seen (**unverified** — the
action was delivered, and the answer says to check the page before doing it
again), and says why; a refusal (a site not allowed, the user has the browser)
stops it at once. The answer lists every step and ends with the page as it is
now, so the agent continues from there with the single tools. A run that
reached its end is remembered with its goal.

Without a key, or with Jev switched off, `browser_run` is not offered at all
and the agent works one action at a time as before. Measured on
books.toscrape.com: two steps with both expectations checked took 2.0 s, and
1.7 s the second time, from memory.

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
- **What the agent is told:** every desktop snapshot ends with the sites it
  may act on, so it does not ask twice for the same one.
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
