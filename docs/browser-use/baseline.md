# Moxxy Browser — baseline (before the browser-use update)

Measured on 2026-10-03, on branch `internal-browser-use-update` at `56fb8fc3`,
before any change to the browser host or tools. This is what every later stage
is compared against.

## How it was measured

`apps/desktop/scripts/browser-trial/` opens an Electron window with the
desktop's real `BrowserHost` and `BrowserBridge` driving a `<webview>`, then runs
the agent against it with `moxxy -p … --allow-all --output-format json`:

```sh
MOXXY_HOME=<throwaway home> node apps/desktop/scripts/browser-trial/run.mjs \
  --out <dir> --prompt apps/desktop/scripts/browser-trial/tasks/<task>.txt --url <start page>
```

- Model: `gpt-6-luna` through `openai-codex`, reasoning effort `medium`, fast mode on.
- `MOXXY_HOME` is a throwaway copy; the real `~/.moxxy` is never touched.
- "Would ask" counts the browser tools that prompt for approval without
  `--allow-all` — how many times a user would have been interrupted.
- `--probe <module>` runs no model: the module drives the window through the
  bridge, which is how each fix was checked against Electron's own webview.

The first round of trials was discarded: the harness left the first view
hidden (`visibility: hidden`) through a race with tab registration, and a
hidden view takes no input at all. The desktop pane does not have that race.
The numbers below are from the second round, after the harness was fixed.

## Results

| Task | Start page | Outcome | Wall | Model calls | Tool calls | Would ask |
|---|---|---|---|---|---|---|
| wiki — search Marmolada, give its height | pl.wikipedia.org | **failed** — stopped for a cookie choice nobody asked for | 19 s | 5 | 4 | 1 |
| books — cheapest Travel book | books.toscrape.com | **wrong answer** (£45.17; the right one is £23.21, which an earlier run did find) | 21 s | 6 | 5 | 2 |
| form — fill and submit Selenium's web form | selenium.dev web-form | **partial** — the select stayed unset; first handed over for a "sign-in" | 26 s | 8 | 7 | 2 |
| edge — 7 steps on `fixtures/edge.html` | local fixture | **failed** — 3 of 7, then the tab died on an `alert()` | 183 s | 43 | 42 | 26 |
| canvas — draw a labelled rectangle | excalidraw.com | **failed** — no way to draw | 70 s | 19 | 18 | 14 |

## What failed, and why

Each was reproduced on its own before it was fixed.

1. **A cookie wall that was not there.** Wikipedia's footer link "Oświadczenie
   o ciasteczkach" names cookies and is pressable, so every snapshot reported a
   consent wall and the agent handed over instead of searching.
2. **A sign-in wall that was not there.** A form with a dozen fields, one of
   them "Password", was read as a sign-in page.
3. **Enter submitted nothing.** Enter was sent as a bare key down; Blink submits
   a form from the keypress an Enter *with text* (`\r`) produces.
4. **Typing appended.** `browser_type` clicked the field and inserted text at
   the caret, so "Jan" became "JanKamil".
5. **A covered button "worked".** A click on a button under a fixed banner
   landed on the banner; the tool reported success and the page did not change.
6. **`alert()` killed the tab.** The press waited on a page that runs no script
   until the dialog is answered; the debugger then reported "target closed" and
   every later command on that tab failed.
7. **A native `<select>` could not be set.** Its options are drawn outside the
   page; clicking and pressing arrows changed nothing.
8. **`target=_blank` opened a bare window.** It appeared beside the app, outside
   the pane, and the agent saw nothing happen.
9. **Frames were empty.** A frame from another site — and, it turned out, from
   the same site too — read as an empty `Iframe` node.
10. **A hidden tab swallowed input.** A press on a view behind another tab
    reaches nothing, and CDP still reports success.
11. **No result said what an action did.** Every click came back as
    `{ tabId, url }`, so the agent read the whole page again to find out.

With most of the vocabulary failing, the agent fell back to `browser_session`
and ran JavaScript in the page (9 calls on the edge task, 10 on canvas) — which
is exactly what clicked the `alert()` button and took the tab down.
