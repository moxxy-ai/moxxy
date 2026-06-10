---
'@moxxy/desktop': minor
'@moxxy/desktop-host': patch
---

fix(desktop): serve the packaged renderer from `https://desktop.moxxy.ai:<port>` so Clerk **production** keys work.

A Clerk production key (`pk_live_`) is domain-locked: its Frontend API rejects any `Origin` that isn't `moxxy.ai` or a subdomain. The packaged renderer was served from a loopback IP origin (`http://127.0.0.1:<port>`), which a `pk_live_` key can never accept, so packaged sign-in with a production key silently failed.

The loopback server now serves over **HTTPS** at `https://desktop.moxxy.ai:<port>` (a `moxxy.ai` subdomain that resolves to `127.0.0.1` via DNS, so traffic stays on-box). HTTPS uses a **self-signed cert** minted on first run and cached under `userData` (no key in the repo/bundle); the main process **scope-trusts** it only for that host + the fixed loopback ports + a matching fingerprint (not a blanket `ignore-certificate-errors`). The Host allow-list, CSP, and `allowedRedirectOrigins` now include the `desktop.moxxy.ai` origin; the DNS-rebinding guard stays intact for every other host. Dev (Vite + `pk_test_`) and the file:// fallback are unchanged.

**Owner setup required** (one-time): add a DNS A-record `desktop.moxxy.ai → 127.0.0.1`, and register the four origins `https://desktop.moxxy.ai:{51789,51790,51791,51792}` in the production Clerk instance's allowed origins. See `docs/desktop-clerk-loopback-subdomain.md`.
