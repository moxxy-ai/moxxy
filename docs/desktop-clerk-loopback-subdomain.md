# Desktop Clerk sign-in

Moxxy serves its packaged renderer from a stable HTTPS origin on loopback. The native Clerk SDK opens Google in the user's default browser. The operating system sends Clerk's callback to the running desktop app via `moxxy://renderer/`.

## Renderer origin

The packaged renderer uses `https://desktop.moxxy.ai:<port>`. Keeping this origin preserves local browser storage across upgrades and lets account-sync check the authorized party of the signed session token. In development, Vite serves the renderer on localhost. Configure each instance with the origins its builds actually use.

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

### (a) Desktop hostname

The bootstrap maps `desktop.moxxy.ai` to loopback in Electron's host resolver.
Google opens in the system browser and returns through the operating system's
`moxxy://` handler. The browser never needs to visit the loopback website.

### (b) Clerk dashboard — allow the desktop origins (production instance)

For the **production** Clerk instance (the one whose `pk_live_` key ships in the
desktop build), add **all four** origins to the instance's allowed origins, preserving all existing entries:

```
https://desktop.moxxy.ai:51789
https://desktop.moxxy.ai:51790
https://desktop.moxxy.ai:51791
https://desktop.moxxy.ai:51792
```

Confirm the production instance permits **subdomains of `moxxy.ai`** (it should
by default, since `desktop.moxxy.ai` is a subdomain of the instance domain).

> No TLS certificate procurement is needed — the app uses a self-signed cert
> that it scope-trusts itself.

### (c) Build-time publishable key (already wired)

The production key goes in **`VITE_CLERK_PUBLISHABLE_KEY`** at build time. It's
read by the renderer (`<ClerkProvider>`) and baked into the main bundle via
electron-vite `define` (so the CSP can include the instance's
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

## Google sign-in and native callbacks

1. In the Clerk instance used by the build, enable Google under Social connections and enable the Native API under Native applications.
2. In Native applications, add `moxxy://renderer/` (including the slash) to the allowlist for mobile SSO redirects. Keep the HTTPS renderer origins above. For a Vite development build also allow the actual localhost origin.
3. Install the full desktop update and start sign-in in Moxxy. Clerk opens Google in the default browser. After consent, approve the browser's prompt to open Moxxy. Keep Moxxy running while signing in. If the attempt expires, start it again from Moxxy.
4. Check that the original Moxxy window displays the account profile and offers Sign out. Use disposable provider credentials when testing device sync.

The native bridge is registered in the desktop bootstrap before Electron becomes ready. Clerk correlates the return with a pending sign-in, focuses the originating window, and completes the session there. OAuth callbacks are excluded from Moxxy's general deep-link stream. The session cache uses the OS keystore and a separate store per Clerk instance. Existing web sessions may require signing in again after the native update.

[Clerk's Electron OAuth guide](https://clerk.com/docs/guides/configure/auth-strategies/oauth-deep-links)
