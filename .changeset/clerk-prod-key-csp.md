---
"@moxxy/desktop-host": patch
"@moxxy/desktop": patch
---

Desktop: fix sign-in doing nothing with a production (`pk_live_`) Clerk key.

The packaged app's CSP and OAuth-popup allow-list only permitted Clerk's
dev/test hosts (`*.clerk.accounts.dev` / `*.clerk.com`). A production
publishable key serves clerk-js from the instance's OWN Frontend API domain
(encoded in the key, e.g. `clerk.<your-domain>`), so the script was
CSP-blocked, clerk-js never initialised, and `clerk.openSignIn()` silently
rendered no modal.

The Frontend API host is now decoded from the publishable key and folded into
the CSP (`script-src`/`connect-src`/`frame-src`/`img-src`) plus the OAuth popup
allow-list. The key is baked into the main bundle via electron-vite `define`
(the renderer already read it via `import.meta.env`). Test keys are unaffected.
