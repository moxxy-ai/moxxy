# @moxxy/plugin-browser

## 0.0.41

### Patch Changes

- @moxxy/sdk@0.24.1

## 0.0.40

### Patch Changes

- Updated dependencies [f71c8bd]
  - @moxxy/sdk@0.24.0

## 0.0.39

### Patch Changes

- Updated dependencies [aec6e0e]
  - @moxxy/sdk@0.23.0

## 0.0.38

### Patch Changes

- Updated dependencies [48542df]
- Updated dependencies [f980349]
- Updated dependencies [1dc1697]
- Updated dependencies [069cd0e]
  - @moxxy/sdk@0.22.0

## 0.0.37

### Patch Changes

- @moxxy/sdk@0.21.1

## 0.0.36

### Patch Changes

- Updated dependencies [074f845]
- Updated dependencies [3a4b604]
  - @moxxy/sdk@0.21.0

## 0.0.35

### Patch Changes

- Updated dependencies [2ccd62e]
- Updated dependencies [9bff8a1]
- Updated dependencies [bddaa83]
- Updated dependencies [5c1c334]
- Updated dependencies [2ccd62e]
  - @moxxy/sdk@0.20.0

## 0.0.34

### Patch Changes

- Updated dependencies [08f927a]
  - @moxxy/sdk@0.19.0

## 0.0.33

### Patch Changes

- Updated dependencies [e4fe785]
  - @moxxy/sdk@0.18.0

## 0.0.32

### Patch Changes

- Updated dependencies [0d6df6e]
  - @moxxy/sdk@0.17.0

## 0.0.31

### Patch Changes

- Updated dependencies [648c966]
  - @moxxy/sdk@0.16.1

## 0.0.30

### Patch Changes

- Updated dependencies [b19d401]
  - @moxxy/sdk@0.16.0

## 0.0.29

### Patch Changes

- Updated dependencies [92fecb8]
  - @moxxy/sdk@0.15.2

## 0.0.28

### Patch Changes

- Updated dependencies [e762d40]
  - @moxxy/sdk@0.15.1

## 0.0.27

### Patch Changes

- 558e299: fix(surfaces): sharper, smoother in-window browser + region-capture-to-chat

  **Sharpness.** The live view was blurry on HiDPI/Retina displays — it streamed a
  1× JPEG (quality 55) that the browser then upscaled into a 2× pane. The Playwright
  context now renders at `deviceScaleFactor: 2` and frames use JPEG quality 70, so
  text is crisp.

  **Less lag.** The poll interval dropped 450ms → 300ms (the `inFlight` guard still
  prevents pile-up), on top of the existing burst-frame-after-each-interaction.

  **Region capture → chat input (replaces element-pick).** The toolbar's selector
  button is now "Capture a region": drag a box over any part of the page and a sharp
  PNG of exactly that area is attached to the chat composer (with a "📎 added to the
  chat input" confirmation). You then describe the change and send — the agent SEES
  the pixels. This is more robust and usable than the old CSS-selector pick: it works
  for any content, not just DOM elements, and rides the normal attach→send flow. New
  sidecar `capture` method (clipped screenshot).

## 0.0.26

### Patch Changes

- Updated dependencies [cbf115b]
  - @moxxy/sdk@0.15.0

## 0.0.25

### Patch Changes

- f22a2b2: feat(surfaces): browser zoom + "select element for the agent"; redesigned Collaborate start

  **Browser zoom.** ⌘+ / ⌘− / ⌘0 (and toolbar buttons) zoom the page in the
  in-window browser (CSS `zoom` via a new sidecar `zoom` method), intercepted so
  they zoom the page rather than the whole desktop app.

  **Select an element for the agent.** A new "select element" toggle lets you click
  any element on the page; the sidecar's `pick` method resolves a best-effort CSS
  selector + text snippet, and a bar appears where you describe a change ("make it
  blue") and hit **Ask agent** — which tasks the session (`session.runTurn`) to
  change that element via the browser tool. Aimed at the localhost dev loop
  ("change this XXX to YYY").

  **Collaborate tab.** Redesigned the "Start a collaboration" empty state: a proper
  composer card (focus ring, ⌘↵ to start, primary action) plus quick-start example
  chips, replacing the bare input + button.

## 0.0.24

### Patch Changes

- 82b8be9: feat(surfaces): interactive in-window browser + richer file preview

  **Browser — a genuinely interactive, full-bleed view.** The live view now behaves
  like a real browser: click / double-click, hover (`:hover` styles + tooltips via
  pointer move), scroll, full keyboard incl. modifier shortcuts, and
  back/forward/reload — with a snappier refresh that bursts a fresh frame after each
  interaction. The page viewport is resized to the pane (`surface.resize` →
  `setviewport`) so the view fills the whole container instead of being letterboxed,
  and clicks map 1:1. The install/loading states are on-brand (spinner, primary
  Button, indeterminate progress bar, condensed progress line) instead of dumping
  raw npm output.

  **Files — preview opens far more types.** Images and PDFs render inline (PDF via
  Chromium's viewer in a `blob:` iframe — `frame-src blob:` added to the CSP);
  text/code open directly; binary-looking or very large files prompt before opening
  as text (a huge blob in a `<pre>` can crash the renderer). `workspace.readFile`
  gained a discriminated result (`kind: text | image | pdf | confirm` plus
  `mediaType` / `base64` / `reason` / `byteLength`) and a `force` flag, and reads
  only a head window via a file handle so a multi-GB file never loads whole.

## 0.0.23

### Patch Changes

- Updated dependencies [50a5b38]
- Updated dependencies [50a5b38]
- Updated dependencies [50a5b38]
  - @moxxy/sdk@0.14.5

## 0.0.22

### Patch Changes

- Updated dependencies [897a1fc]
  - @moxxy/sdk@0.14.4

## 0.0.21

### Patch Changes

- 0c86701: fix(surfaces): make the terminal a real PTY + offer to install the browser engine

  **Terminal — the root cause it never accepted input.** node-pty ships its macOS
  `spawn-helper` binary without the executable bit, and several install/repack
  paths (npm into the desktop's CLI prefix, pnpm's content store) keep it that way.
  node-pty then loads fine but `pty.spawn` throws `posix_spawnp failed`, which was
  silently swallowed into the piped fallback — a shell with no TTY line discipline,
  so a viewer's Enter (`\r`) never reaches it and nothing echoes. The pane looked
  alive (it showed a prompt) but ignored every keystroke. This affected dev and
  packaged builds alike, which is why earlier UI/sizing/ref-count fixes didn't
  help. Fix: `pty.ts` now repairs the `spawn-helper` exec bit before spawning and
  retries once; the installer chmods it after `npm install` too. When a real PTY
  genuinely can't start, the pane shows an honest "Terminal unavailable" status
  instead of a silently-dead box.

  **Browser — offer to install Playwright instead of erroring.** When the
  `playwright` npm package is missing, the browser surface now reports a distinct
  `needs-install` state and shows an **Install browser engine (~200MB)** button.
  On click it installs the npm package + the Chromium engine with live progress in
  the pane, restarts the sidecar, and resumes — no manual `npm i playwright` in the
  install dir.

## 0.0.20

### Patch Changes

- Updated dependencies [5f20dab]
  - @moxxy/sdk@0.14.3

## 0.0.19

### Patch Changes

- Updated dependencies [091ef41]
  - @moxxy/sdk@0.14.2

## 0.0.18

### Patch Changes

- Updated dependencies [640d036]
  - @moxxy/sdk@0.14.1

## 0.0.17

### Patch Changes

- Updated dependencies [e1fb6a6]
- Updated dependencies [e1fb6a6]
  - @moxxy/sdk@0.14.0

## 0.0.16

### Patch Changes

- Updated dependencies [89ad994]
  - @moxxy/sdk@0.13.0

## 0.0.15

### Patch Changes

- Updated dependencies [33e9640]
- Updated dependencies [143264a]
- Updated dependencies [7366a09]
- Updated dependencies [951f374]
  - @moxxy/sdk@0.12.0

## 0.0.14

### Patch Changes

- Updated dependencies [aacdf1d]
  - @moxxy/sdk@0.11.0

## 0.0.13

### Patch Changes

- Updated dependencies [2796066]
  - @moxxy/sdk@0.10.0

## 0.0.12

### Patch Changes

- Updated dependencies [1e4ed09]
- Updated dependencies [4a8ec5d]
- Updated dependencies [6afc4c0]
  - @moxxy/sdk@0.9.0

## 0.0.11

### Patch Changes

- cf2f651: Security: four audit leftovers (A43–A46). MCP server credentials now support `${vault:NAME}` placeholders in env/header values, resolved only at connect time (the persisted mcp.json and the model-visible tool args keep the placeholder; `mcp_add_server`/`mcp_test_server` instruct vault-first). Agent-view URLs are scheme-allow-listed (`https`/`http`/`mailto`/`tel` + relative; `data:image/*` for img src only) at BOTH walls: a canonical `isSafeViewUrl` in the sdk enforced by `parseView` and `validateDoc`, and a render-time re-check in the web frontend that neutralizes `javascript:`/`data:text` hrefs and srcs. `web_fetch` closes its DNS-rebinding TOCTOU by pinning every hop's connection to the SSRF-guard-vetted addresses via an undici dispatcher with a fixed lookup (SNI/cert validation intact). Telegram inline-keyboard callbacks now enforce the same pairing authorization gate as text/voice messages.
- Updated dependencies [cf2f651]
- Updated dependencies [cf2f651]
- Updated dependencies [cf2f651]
- Updated dependencies [cf2f651]
  - @moxxy/sdk@0.8.1

## 0.0.10

### Patch Changes

- f297da0: Security: `browser_session.goto` now enforces the same SSRF guard as `web_fetch`. The `assertPublicUrl` check (loopback, RFC-1918, link-local incl. the 169.254.169.254 metadata endpoint, CGNAT, multicast, IPv6 ULA/link-local, with hostname resolution) moved into a shared `ssrf-guard` module and runs in the parent before the goto RPC, again inside the Playwright sidecar's dispatch (defence in depth), and on every top-level/iframe navigation via context route interception — so a page can't redirect itself into a private origin after a legitimate goto. Subresource requests are not filtered; this residual risk is documented in the tool description.
- Updated dependencies [0326fb0]
- Updated dependencies [2e4bc37]
- Updated dependencies [f3c798f]
- Updated dependencies [0326fb0]
  - @moxxy/sdk@0.8.0

## 0.0.9

### Patch Changes

- Updated dependencies [85f9b91]
  - @moxxy/sdk@0.7.0

## 0.0.8

### Patch Changes

- Updated dependencies [eac83e5]
  - @moxxy/sdk@0.6.0

## 0.0.7

### Patch Changes

- Updated dependencies [b928391]
  - @moxxy/sdk@0.5.1

## 0.0.6

### Patch Changes

- Updated dependencies [ad26425]
- Updated dependencies [e64aa0e]
  - @moxxy/sdk@0.5.0

## 0.0.5

### Patch Changes

- Updated dependencies [b014c3a]
  - @moxxy/sdk@0.4.0

## 0.0.4

### Patch Changes

- Updated dependencies [d362a6b]
  - @moxxy/sdk@0.3.0

## 0.0.3

### Patch Changes

- Updated dependencies [0afd61d]
  - @moxxy/sdk@0.2.0

## 0.0.2

### Patch Changes

- Updated dependencies [93d9a2d]
  - @moxxy/sdk@0.1.3

## 0.0.1

### Patch Changes

- Updated dependencies [c4352f9]
  - @moxxy/sdk@0.1.0
