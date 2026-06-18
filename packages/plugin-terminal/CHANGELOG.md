# @moxxy/plugin-terminal

## 0.0.8

### Patch Changes

- Updated dependencies [897a1fc]
  - @moxxy/sdk@0.14.4

## 0.0.7

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

## 0.0.6

### Patch Changes

- Updated dependencies [5f20dab]
  - @moxxy/sdk@0.14.3

## 0.0.5

### Patch Changes

- Updated dependencies [091ef41]
  - @moxxy/sdk@0.14.2

## 0.0.4

### Patch Changes

- Updated dependencies [640d036]
  - @moxxy/sdk@0.14.1

## 0.0.3

### Patch Changes

- Updated dependencies [e1fb6a6]
- Updated dependencies [e1fb6a6]
  - @moxxy/sdk@0.14.0

## 0.0.2

### Patch Changes

- Updated dependencies [89ad994]
  - @moxxy/sdk@0.13.0

## 0.0.1

### Patch Changes

- Updated dependencies [33e9640]
- Updated dependencies [143264a]
- Updated dependencies [7366a09]
- Updated dependencies [951f374]
  - @moxxy/sdk@0.12.0
