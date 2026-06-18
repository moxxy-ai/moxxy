---
"@moxxy/plugin-terminal": patch
"@moxxy/plugin-browser": patch
"@moxxy/desktop-host": patch
"@moxxy/desktop": patch
---

fix(surfaces): make the terminal a real PTY + offer to install the browser engine

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
