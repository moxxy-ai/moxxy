# Moxxy Browser

The desktop's Browser pane is a real Chromium view (a `<webview>`) that the
agent drives and the user watches. Every click the agent makes is a click on
that view, so the user can see it happen and take over at any moment. Outside
the desktop — the terminal UI, `moxxy -p` — the same tools drive a headless
Playwright browser instead, through the same `BrowserHost`: everything below
works there too, except the pointer, taking over and hand-offs, which need a
window someone can see.

The headless browser keeps a profile on disk (`~/.moxxy/browser/profile`),
as the pane keeps its own, so a site the user signed it in to stays signed in
from run to run. Signing in happens in a window the person uses:

```sh
moxxy browser login canva.com   # opens a window; sign in, close it — the profile keeps it
moxxy browser sites             # sites with a saved sign-in
moxxy browser logout canva.com  # forget one site (its subdomains too)
moxxy browser logout --all      # forget every sign-in (deletes the profile)
```

The same actions are `/browser …` in the TUI. One browser holds the profile
at a time — a lock file (`profile.lock`) names its holder, because Chromium
under Playwright does not refuse a second one and two would corrupt the cookie
store. A run that finds the profile held starts signed out and says so; login
and logout refuse until the holder lets go. The profile is protected by the
`~/.moxxy` permissions (0700), not by the OS keychain: on macOS and Linux Playwright's Chromium
encrypts cookies with a fixed key.

- [Baseline](baseline.md) — what the browser could and could not do before.
- [Results by stage](results.md) — the same tasks after each stage.

## How an action works

`BrowserHost` (`packages/plugin-browser/src/page/`) drives a tab over CDP. A
tab is the slice of Electron's `WebContents` the host needs: on the desktop the
pane's view, in the headless sidecar a Playwright page dressed the same way
(`sidecar/playwright-contents.ts`). The wire methods the tools call are one
table, `dispatchToHost`, which both the desktop's bridge and the sidecar use.
An action on an element named by a `uid` from the last snapshot goes the way a
person's would, and every step that can go wrong says so:

1. **The tab comes to the front.** A view behind another tab takes no input at
   all, so the agent's tab is shown before anything is pressed — which is also
   what lets the user see it.
2. **The element is scrolled into view** and its place read from the page —
   once the document has been parsed. A navigation answers while the page is
   still loading, before its styles apply, and an element measured then is
   somewhere else a moment later; `browser_navigate` therefore returns once the
   new document is parsed (up to 5 s), and a press waits the same way. The
   place is the middle of the element's largest line box: a link that wraps
   onto two lines has one box per line, and the middle of the box around both
   can fall between them, on the sentence that holds the link.
3. **Checks**: a disabled control is refused; if something covers the element
   (a banner, a dialog, a menu), the press is refused with the name of what is
   in the way. What is there is asked of the page itself
   (`elementFromPoint`, in the viewport coordinates the point was measured
   in): `DOM.getNodeForLocation` read the point as if the page had not
   scrolled in the terminal's Chromium, so a button scrolled into view was
   "covered" by whatever had been at that spot before. A menu held open by the pointer is given the chance to close
   first, and the element is then measured again: the page may have moved
   meanwhile (a form field that grows as it is typed into pushes the button
   below it down), and the second look must be at where the element is now,
   not where it was.
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

## Reading a page

`browser_snapshot` sends the accessibility tree once, then only what changed;
"unchanged" means the page has not moved. `full: true` always sends the whole
tree, even for a page that has not moved — that is how the agent finds its
bearings again. Rows deeper than the depth cap collapse to one, and an
unnamed collapsed row keeps the text it holds (`paragraph ... (2 descendants)
text: "£53.74"`), so a price or a date deep in a list is not lost.

### What a page may and may not ask

Every read starts with a note that the page is untrusted data. The page never
adds to or changes the task: a request to go somewhere, send data, run
something or ignore the instructions is reported, not followed. What it says
about the work the user asked for — an error, a required field, "Please
redeploy to apply the new configuration" after the agent changed a setting —
is information the agent acts on within that task. Before this distinction the
agent reported that notice and left its own change unapplied.

The note is a soft defence; the hard ones do not depend on it: each site is
allowed by the user, internal hosts are refused, credential-shaped values are
redacted from every read, and the agent never types a password.

### What a read costs

Every read stays in the conversation and is sent again with each later call
to the model, so its size is paid many times over. In the Coolify trial one
read of the service catalogue (≈300 cards) was 178,073 characters, +48,011
tokens in one call, and the task carried it through 44 calls of the next turn.
Four rules keep that bounded:

- **A read has a ceiling.** 20,000 characters for a read, 50,000 for one asked
  for whole (`full: true`), 6,000 for the read that closes a `browser_run`.
  A longer page is cut at a whole row and ends with "… N more rows not shown";
  the rest is still there, its uids still work, and `browser_find` searches it.
- **A large removal is one line.** Filtering a list from 300 cards to 3 used
  to send back all 297 rows that went away; now it says
  `- 297 elements went away (among them "…", …); their uids no longer work`.
  Up to five removals are still listed row by row, and a changed row repeats
  only the first 80 characters of what it used to say.
- **Look up instead of reading.** `browser_find` takes a few words and gives
  back up to 20 matching rows with their uids, from the whole page. Every word
  must appear in a row, so a role narrows it (`postgresql link`). A label that
  matches brings the field after it (`→ field: [8] textbox …`), which is how a
  form whose labels are not tied to their fields is filled.
- **A page read whole retires the reads before it.** Every read names its tab
  (`supersede: { key: "browser:t1", whole }`). Once the same tab is read whole
  again, earlier reads of it — and the changes reported against them — are
  sent as a one-line marker with the `recall("…")` that brings them back. A
  read of only what changed never retires anything, because it means
  something only against the read before it. The rule lives in `@moxxy/sdk`
  (`supersede.ts`) and holds for any tool result that names a key this way.

## Tools

Every tool is offered on both backends: `browser_snapshot`, `browser_find`, `browser_click`,
`browser_type`, `browser_key`, `browser_batch`, `browser_navigate`,
`browser_tabs`, `browser_capture`, `browser_history`, `browser_await_human`,
and these:

| Tool | What it does | Asks first |
|---|---|---|
| `browser_find` | Looks words up on the page and gives back only the matching rows with their uids; a matching label brings its field | no |
| `browser_allow_site` | Asks the user to allow a site for the rest of the conversation | yes |
| `browser_select` | Picks an option in a native `<select>` by its label or value | no (site consent) |
| `browser_dialog` | Accepts or dismisses a `confirm` / `prompt` (an `alert` is accepted by the click itself and quoted) | yes |
| `browser_scroll` | Scrolls the page, or the part a uid sits in, by screens; says whether it moved | no |
| `browser_hover` | Moves the pointer over an element, for hover menus | no |
| `browser_wait` | Waits for a text to appear or go away; `met: false` means not yet | no |
| `browser_point` | Clicks, double/right-clicks, moves, drags, scrolls, presses a key or types at a place in the latest viewport picture | no (site consent) |
| `browser_upload` | Gives a file field local files, as the file dialog would | yes, every time |
| `browser_run` | Carries out a run of steps named in words, finding each element and checking each `expect` with Jev — only with a TypeSafe key and Jev on | no (site consent) |

`browser_type` replaces what a field holds (it no longer appends) and takes
`submit: true` to press Enter afterwards. In the headless browser
`browser_await_human` answers at once that nobody can take the page over there,
so the agent tells the user what the page needs instead of waiting.

`web_fetch` takes `untilUpMs` to check a service that was just deployed or
restarted: it keeps trying every 5 seconds while the address refuses the
connection or answers 5xx (up to 5 minutes), and says "up after N s" or
"still not up after N s" with the last answer. A refused address (internal,
too many redirects) is never retried.

### Controls with no name

An icon-only button has no accessible name, so the tree can say only
`button`. On such a control a read shows what its markup says instead —
`[236] button (no name; markup: @click="modalOpen=false")` — from the attribute
that wires its click (`onclick`, `@click`, `x-on:click`, `wire:click`,
`v-on:click`, `ng-click`, `hx-*`), or else its `title`, `data-testid`, `id` or
`name`. It comes from the same `DOMSnapshot` capture that finds clickable
`div`s, taken only when the page has such a control. A run (`browser_run`)
offers these controls to Jev under that description; one with nothing in its
markup is still left out, since nothing tells it from the next one.

### Work still under way

A page read lists, under `### In progress`, what the page itself marks as not
finished — anything with `aria-busy`, and a progress bar that shows no amount
(the spinner kind; a bar with an amount is as often a gauge and is left out).
A document's own busy state is left out too: it only means the page is still
loading, and some pages never finish (n8n's sign-in page held its root busy).
Those rows also carry `[in progress]` in the tree. An action whose page was
still changing when its settle wait ran out (or still loading) says so. Both
signals are generic — no site's wording is matched.

They reach the agent loop through `progress: { key, pending }` on the tool
result (the `Progress` contract in `@moxxy/sdk`; any tool can use it). The
default mode checks it when the agent ends its turn: if the last look at
something found work still under way, the agent is asked once to wait, look
again and report what it sees then — or to say plainly that it had not
finished. A turn with nothing pending is not touched and leaves nothing in the
log.

## Working by picture

A canvas app (Excalidraw, a map, a chart) shows things the accessibility tree
cannot name. There the agent takes `browser_capture` without a uid: that is a
**view** — `v1`, `v2`, … — a picture of the viewport in CSS
pixels (not the screen's: a Retina screen would make it four times the cost),
answered with its size. With a uid, the picture is cropped to everything the
element draws — its padding and border too, content that overflows an element
with no size of its own (a 0-wide flex container holding a canvas), and for an
element in a frame from another site, offset by where that frame sits; an
element that draws nothing is an error that says so, rather than an empty
picture, and a uid the page does not have is answered with "leave uid out". `browser_point` then acts at x, y of that picture:
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
`hover`. For each one the backend serves the page as Jev reads it — the
elements one can act on under the uids the other tools use, and the page as
text (`tree` on the bridge, which leaves the agent's own reads untouched) — and
code finds the element, in this order. The elements one can act on are those
with an interactive role plus anything the browser says answers a click
(`DOMSnapshot.isClickable`, which counts click listeners): a card grid built
from `div`s — Coolify's catalogue of services — is listed card by card, each
titled by its first line of text and described by the rest, so "N8N" finds the
N8N card. A clickable wrapper showing more than a label's worth of text is left
out, and so is a control with no name and no value: Jev cannot tell one nameless
button from another, and offering them only invites a blind guess. A field whose
`<label>` is not tied to it — Coolify's settings again — is named by the label
standing right before it ("Domains"), and what it was called until then, often
its placeholder, becomes its description.

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
again), and says why. A step whose element is not found names the closest
ones and says one of them may be what was meant under another name — an agent
told "closest: Restart" twice kept looking for a Redeploy button. A `type` step is also read back off its field: a field
that does not hold the text fails the step, whatever the page shows elsewhere —
Jev, checking against the whole page, once took a domain typed into the wrong
field for a domain in the right one. Jev is told which element the step acted
on, and only a step whose effect was seen — or whose field holds the text — is
remembered for the next run; an unchecked guess is not. A refusal (a site not
allowed, the user has the browser)
stops it at once. The answer lists every step and ends with the page as it is
now, so the agent continues from there with the single tools. A run that
reached its end is remembered with its goal.

Without a key, or with Jev switched off, `browser_run` is not offered at all
and the agent works one action at a time as before. Measured on
books.toscrape.com: two steps with both expectations checked took 2.0 s, and
1.7 s the second time, from memory.

## Allowing a site

The person allows a **site** once, and the agent then acts there without a
prompt per action — on the desktop and in the terminal alike. Click, type,
keys, batch, navigate, history, tabs and select ask nothing on their own;
instead the backend refuses any of them
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
- **What the agent is told:** every snapshot ends with the sites it
  may act on, so it does not ask twice for the same one.
- **Still asked every time:** `browser_dialog` (a confirm usually guards
  something final) and `browser_session`, whose calls carry no sites.
- **Where it lives:** the approved `browser_allow_site` result in the session
  log, so every client of the conversation sees the same sites; each call
  carries them (`sites`), folded from the log by `sitesFromLog`. A policy rule
  in `~/.moxxy/permissions.json` still wins.

## Taking the browser back (desktop)

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
a form that merely has a password field among others is not a sign-in, and a
page that only *mentions* a CAPTCHA — Coolify lists a service called "Cap
Captcha" — is not running one: a CAPTCHA counts only as its widget (a frame, a
checkbox or an answer field named for it). None of these stops the agent any more. A password field is still never typed into.
The pane waits ten minutes for the user to finish (`HANDOFF_LIMIT_MS`), and
the call from the runner to the pane waits as long, plus a moment to answer —
not the 150 s ceiling every other call has.

## Frames, dialogs, new tabs

- **Frames** are read into the snapshot under their `Iframe` node, from the
  same site and from other sites (each of those through its own CDP session),
  and their elements can be clicked and typed into like any other.
- **Dialogs**: an `alert` is accepted and its text returned with the click; a
  `confirm` or `prompt` stays open, the page is frozen until it is answered,
  and every other action on that tab says to answer it with `browser_dialog`.
- **New windows** (`target=_blank`, `window.open`) open as tabs in the pane —
  in the headless browser as tabs of its own — and the click that opened one
  returns its `tab_id`. A tab the site opens does not move a command that
  names no tab off the tab the agent was working in. On the desktop this
  rests on the view's `allowpopups` attribute, written as the string
  `"true"`: React drops a bare boolean on `<webview>`, and without it
  Electron refuses the window before main's handler sees it.

## Trying it

`apps/desktop/scripts/browser-trial/` runs the agent, or a scripted probe,
against a window with the desktop's real browser host — see the header of
`run.mjs`. Never point it at the real `~/.moxxy`; pass a throwaway `MOXXY_HOME`.
