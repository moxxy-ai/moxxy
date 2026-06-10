# Desktop Clerk sign-in: serving the renderer from `https://desktop.moxxy.ai`

The packaged **MoxxyAI Workspaces** desktop app serves its renderer from an
in-app loopback server at **`https://desktop.moxxy.ai:<port>`** so that **Clerk
production keys (`pk_live_`) work** in the desktop sign-in flow.

This doc explains *why* (the Clerk Origin-lock problem), *how* (a self-signed
cert + scoped trust), and — most importantly — the **one-time owner setup**
(DNS record + Clerk dashboard origins) the feature depends on.

---

## The problem: Clerk production keys are domain-locked

clerk-js (the Clerk web SDK) runs inside the renderer and calls Clerk's
Frontend API with an `Origin` header equal to the renderer's origin. A Clerk
**production** instance is locked to its instance domain: it **rejects any
`Origin` that isn't `moxxy.ai` or a subdomain of it** —

> `Production Keys are only allowed for domain moxxy.ai` /
> `Origin header must be … a subdomain`

Previously the packaged renderer was served from a loopback **IP** origin
(`http://127.0.0.1:<port>`). That's a secure context and works fine for a
**dev** key (`pk_test_`), but a `pk_live_` key can **never** accept a bare
`127.0.0.1` origin — it isn't a `moxxy.ai` subdomain. So packaged sign-in with a
production key silently failed.

`file://` is even worse: clerk-js rejects it outright (`prohibited_redirect_url`).

## The fix: serve from a `moxxy.ai` subdomain that resolves to loopback

The renderer is now served at **`https://desktop.moxxy.ai:<port>`**, where
`desktop.moxxy.ai` is a **public DNS A-record pointing at `127.0.0.1`**. The
hostname is a `moxxy.ai` subdomain, so Clerk production accepts the origin — but
because it only ever resolves to loopback, the server is **not externally
reachable**: the bytes never leave the machine.

- **Dev is unchanged.** With `ELECTRON_RENDERER_URL` set (Vite), the app loads
  from `http://localhost:<vite-port>` and a `pk_test_` key works from localhost
  exactly as before. Only the **packaged** build uses `desktop.moxxy.ai`.
- A **missing / dev key** is graceful: the renderer mounts without
  `<ClerkProvider>` (no sign-in gate), and the loopback server still serves the
  app. The loopback fallback to `file://` (if every port is taken) still boots.

### Self-signed cert + scoped trust (no real TLS cert needed)

HTTPS on a real hostname needs a certificate. We deliberately do **not** ship a
real (Let's Encrypt) private key:

- **Generate-at-first-run-and-cache.** On first packaged launch the main process
  mints a **self-signed RSA-2048 / SHA-256 cert** for `desktop.moxxy.ai` (SAN =
  `DNS:desktop.moxxy.ai`) using only `node:crypto` — no third-party cert library,
  no OpenSSL, no key in the repo or bundle. It's cached under `userData`
  (`loopback-cert.pem` / `loopback-key.pem`, key written `0600`) and re-minted if
  missing, stale, or within 30 days of expiry. See
  `packages/desktop-host/src/self-signed-cert.ts`.
- **Scoped trust — NOT `ignore-certificate-errors`.** The main process installs
  an `app.on('certificate-error')` handler that trusts the cert **only** when
  *all* of these hold: the URL host is `desktop.moxxy.ai`, the port is one of the
  fixed loopback ports, **and** the presented cert's SHA-256 fingerprint matches
  the one we minted. Every other certificate error falls through to normal
  Chromium verification. The decision logic is the pure, unit-tested
  `isTrustedLoopbackCert()` helper.

Because the server only ever serves our own `dist/` over loopback and the trust
is fingerprint-pinned to our own cert, a self-signed cert is no weaker than the
loopback bind already is.

### Fixed ports → deterministic origins

The loopback server binds the **first free** of these fixed ports (in order):

```
51789, 51790, 51791, 51792
```

Clerk matches allowed origins **exactly, including the port**, so every
candidate port must be registered in the Clerk dashboard (see below). The list
is kept short and stable for that reason; `51789` is used unless it's taken.

---

## ⚠️ Owner setup required (one-time)

The app code is wired for all of this, but it **does not work until the owner
completes these one-time steps**. They are owner-only (DNS + Clerk dashboard +
build-time key).

### (a) DNS — point `desktop.moxxy.ai` at loopback

Add to the `moxxy.ai` zone:

| Type | Name             | Value       |
|------|------------------|-------------|
| A    | `desktop.moxxy.ai` | `127.0.0.1` |
| AAAA | `desktop.moxxy.ai` | `::1`       | *(optional — only if IPv6 loopback is needed; the server binds IPv4 `127.0.0.1`, so the A record is what matters)* |

This record is intentionally a loopback address, so the name is **never
externally reachable** — it only ever resolves to the user's own machine.

### (b) Clerk dashboard — allow the desktop origins (production instance)

For the **production** Clerk instance (the one whose `pk_live_` key ships in the
desktop build), add **all four** origins to the allowed origins / allowed
redirect origins (the server-side check that mirrors the renderer's
`allowedRedirectOrigins`):

```
https://desktop.moxxy.ai:51789
https://desktop.moxxy.ai:51790
https://desktop.moxxy.ai:51791
https://desktop.moxxy.ai:51792
```

Confirm the production instance permits **subdomains of `moxxy.ai`** (it should
by default, since `desktop.moxxy.ai` is a subdomain of the instance domain).

> No TLS certificate procurement is needed — the app uses a self-signed cert
> that it scope-trusts itself. You only need the DNS record + these origins.

### (c) Build-time publishable key (already wired)

The production key goes in **`VITE_CLERK_PUBLISHABLE_KEY`** at build time. It's
read by the renderer (`<ClerkProvider>`) and baked into the main bundle via
electron-vite `define` (so the CSP + OAuth allow-list can fold in the instance's
own Frontend API host). Nothing further to wire — just set the env var in CI.

---

## Where it lives in the code

| Concern | File |
|---|---|
| Cert generation + cache + scoped-trust decision + `DESKTOP_APP_HOST` constant | `packages/desktop-host/src/self-signed-cert.ts` |
| HTTPS loopback static server (Host allow-list incl. `desktop.moxxy.ai`, origin) | `packages/desktop-host/src/loopback-server.ts` |
| Wire-up: mint cert, start server, `certificate-error` scoped trust, CSP, ports | `apps/desktop/electron/main/index.ts` |
| Renderer `allowedRedirectOrigins` | `apps/desktop/src/main.tsx` |
| CSP (folds in the loopback origin + prod Clerk Frontend API host) | `packages/desktop-host/src/security.ts` |

---

## Postscript (2026-06-11): the flow is a TOP-FRAME redirect, not a popup

First real packaged-build sign-in attempt surfaced one more blocker: clicking
"Continue with Google" did nothing (eternal button spinner, no window). The
serving stack was healthy — DNS, loopback https, `allowed_origins` all verified
— and the FAPI `POST /v1/client/sign_ins` returned the Google
`external_verification_redirect_url` fine.

The wrong assumption was that clerk-js opens the provider in a **popup**
(`window.open` → `setWindowOpenHandler`). The prebuilt `openSignIn` modal
actually runs OAuth as a **top-frame redirect** (`window.location = accounts.google.com…`),
which `lockDownNavigation`'s blanket `will-navigate`/`will-redirect` deny
silently swallowed. Fix: `lockDownNavigation` takes `allowOriginPatterns`; the
main window passes `OAUTH_HOST_PATTERNS` **plus its own loopback serving
origins** — the return leg (`clerk.moxxy.ai → desktop.moxxy.ai:<port>`) is not
same-origin with the page's mid-flow URL, so the app origins must be explicit.
The focus window passes nothing and keeps the blanket deny.

Also folded `challenges.cloudflare.com` into CSP `connect-src` (Clerk's
documented Turnstile set) so the sign-up captcha can't dead-end.
