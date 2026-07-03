---
'@moxxy/cli': minor
'@moxxy/plugin-plugins-admin': minor
'@moxxy/plugin-browser': minor
'@moxxy/plugin-terminal': minor
'@moxxy/plugin-channel-web': minor
'@moxxy/plugin-tunnel-proxy': minor
'@moxxy/e2e': minor
'@moxxy/desktop': patch
---

Slim wave, batches 3+4: `@moxxy/plugin-browser`, `@moxxy/plugin-terminal`
and `@moxxy/plugin-channel-web` move out of the CLI binary and install on
demand (all three are in the desktop plugins-seed, so desktop surfaces keep
working offline). The CLI's `dist/` drops the Playwright `sidecar.js` entry
and the copied web frontend — a standalone browser install resolves its own
`dist/sidecar.js`, and the web channel serves its own `dist/public` next to
its module. `node-pty` moves from the CLI's optionalDependencies into
plugin-terminal's own (piped-shell fallback without it).
`@moxxy/plugin-tunnel-proxy` + `@moxxy/e2e` flip public as web's dependency
closure; `@moxxy/e2e` joins the fixed changeset group so pinned installs
resolve from their first release.
