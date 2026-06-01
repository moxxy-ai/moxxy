---
---

chore(ci): stop the release pipeline from cutting a desktop tag during a
Version-PR (mode-1) run. `changesets/action`'s `version` command bumps
`apps/desktop/package.json` in the working tree before the "Cut desktop release"
step reads it, so the step tagged `desktop-v<next>` prematurely while the build
job (checking out the un-bumped commit) shipped lower-versioned artifacts — and
no `moxxy-app-bundle-<next>.json.gz` — under that tag, 404-ing the self-updater.
Gate the cut on `hasChangesets == 'false'` and pin the desktop build/guard
checkouts to the cut tag. CI-only; releases nothing.
