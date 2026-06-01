---
"@moxxy/desktop": patch
---

fix(desktop): a hot-update that failed to boot once could never be installed
again. The bootstrap poisons a bundle version (adds it to `bad.json`) when its
renderer doesn't confirm a healthy mount in time, but nothing ever cleared that
mark — so every later "download + restart" re-staged the same version,
`resolveActiveBundle` rejected it as poisoned, and the app silently fell back to
the packaged floor ("downloads, but restart still shows the old version").
`downloadAndStage` now clears the poison mark for the version it installs, since
an explicit user (re)install is a deliberate retry; the boot-probe still
re-poisons a genuinely broken bundle, so this only ever grants one fresh attempt.
