---
'@moxxy/desktop-host': minor
'@moxxy/desktop': minor
---

Desktop plugins seed: the packaged app now bundles a ready-to-copy npm tree
of the on-demand first-party plugins (API-key providers + the slim-wave
unbundled set) and copies it into `~/.moxxy/plugins` on first launch —
an OFFLINE first run with no npm and no network, while the CLI binary stays
slim. Idempotent: never overwrites a user-updated install; merges the seed's
dependency ledger into the target manifest so later `npm install --save`
runs keep working. Assembled at build time from local pnpm-pack tarballs
(including the sdk/core closure), so the desktop build does not depend on
the same release's npm publish having landed.
