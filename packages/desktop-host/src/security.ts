/**
 * Security helpers for the Electron main process.
 *
 * The renderer is untrusted from the main process's point of view: a
 * single XSS (e.g. via rendered markdown) would otherwise inherit the
 * main process's filesystem + child-process authority. These helpers
 * gate the dangerous edges — IPC input validation, navigation lockdown,
 * a Clerk-compatible Content-Security-Policy, and secret redaction for
 * the diagnostics the renderer is allowed to see.
 */

import type { BrowserWindow, Session } from 'electron';

// ---- IPC input validation -------------------------------------------------

/**
 * Provider names are interpolated into vault key names
 * (`<PROVIDER>_API_KEY`) and passed as argv tokens to
 * `moxxy login <provider>` / `moxxy vault set`. Confine them to a strict
 * slug so a compromised renderer cannot inject a CLI flag (`--foo`),
 * traverse the vault namespace (`../`), or smuggle a path separator.
 */
const PROVIDER_NAME = /^[a-z][a-z0-9-]{0,63}$/;

export function isSafeProviderName(provider: string): boolean {
  return PROVIDER_NAME.test(provider);
}

export function assertSafeProviderName(provider: string): void {
  if (typeof provider !== 'string' || !PROVIDER_NAME.test(provider)) {
    throw new Error(`invalid provider name: ${JSON.stringify(provider)}`);
  }
}

/**
 * Only ever hand http/https URLs to the OS via `shell.openExternal`.
 * `file://`, `javascript:`, and custom-protocol URIs handed to the OS
 * shell are RCE-adjacent on Windows/macOS.
 */
export function isSafeExternalUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

export function assertSafeExternalUrl(url: string): void {
  if (typeof url !== 'string' || !isSafeExternalUrl(url)) {
    throw new Error(`refusing to open non-http(s) URL: ${JSON.stringify(url)}`);
  }
}

// ---- secret redaction -----------------------------------------------------

/**
 * Best-effort scrub of secrets from a runner log line before it crosses
 * the IPC boundary into the renderer (where it is shown in the
 * connection diagnostics). A plugin that accidentally echoes a key to
 * stdout must not leak it into untrusted renderer memory.
 */
const SECRET_PATTERNS: ReadonlyArray<RegExp> = [
  /\bsk-[A-Za-z0-9_-]{16,}/g, // OpenAI / Anthropic secret keys
  /\b[a-z]{2,4}_(?:live|test)_[A-Za-z0-9]{8,}/g, // Stripe/Clerk-style scoped keys
  /\bBearer\s+[A-Za-z0-9._~+/-]{12,}=*/gi, // bearer tokens
  /\beyJ[A-Za-z0-9._-]{20,}/g, // JWTs
  /\b([A-Z0-9_]*(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|PASSPHRASE))\b\s*[=:]\s*\S+/gi, // KEY=value
];

export function redactSecrets(line: string): string {
  let out = line;
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, (_m, label?: string) =>
      label ? `${label}=«redacted»` : '«redacted»',
    );
  }
  return out;
}

// ---- navigation lockdown --------------------------------------------------

function sameOrigin(a: string, b: string): boolean {
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    // file:// documents share an opaque origin; treat any file:// → file://
    // navigation (e.g. between bundled HTML entries) as same-origin.
    if (ua.protocol === 'file:' && ub.protocol === 'file:') return true;
    return ua.origin === ub.origin;
  } catch {
    return false;
  }
}

/**
 * Refuse to navigate the top frame away from the app's own origin and
 * (unless the window installs its own handler) deny `window.open`. An
 * XSS that tries to point the window at a remote page or spawn a
 * privileged popup is stopped here. Hash routing (`#focus`) is in-page
 * and unaffected.
 *
 * `allowOriginPatterns` punches a deliberate, narrow hole for the Clerk
 * OAuth flow: clerk-js's prebuilt sign-in buttons run the provider flow as
 * a TOP-FRAME redirect (`window.location = accounts.google.com…`), not a
 * popup — with a blanket deny the click silently no-ops (eternal button
 * spinner; the original packaged-app sign-in bug). The main window passes
 * its OAuth host patterns + its own serving origins, so the frame may
 * round-trip app → provider → Clerk FAPI → back to the app, and nothing
 * else. Windows that never sign in (focus widget) pass none and keep the
 * blanket deny.
 */
export function lockDownNavigation(
  win: BrowserWindow,
  opts: {
    readonly keepWindowOpenHandler?: boolean;
    /** Origins (matched as `URL.origin`) the top frame MAY navigate to. */
    readonly allowOriginPatterns?: ReadonlyArray<RegExp>;
  } = {},
): void {
  const wc = win.webContents;
  const allowed = opts.allowOriginPatterns ?? [];
  const guard = (event: { preventDefault: () => void }, url: string): void => {
    if (sameOrigin(url, wc.getURL())) return;
    let origin: string;
    try {
      origin = new URL(url).origin;
    } catch {
      event.preventDefault();
      return;
    }
    if (allowed.some((re) => re.test(origin))) return;
    event.preventDefault();
  };
  wc.on('will-navigate', guard);
  wc.on('will-redirect', guard);
  wc.on('will-attach-webview', (event) => event.preventDefault());
  if (!opts.keepWindowOpenHandler) {
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  }
}

// ---- Clerk Frontend API host ----------------------------------------------

/**
 * Decode the Frontend API host a Clerk publishable key points at.
 *
 * A publishable key is `pk_test_` / `pk_live_` followed by the base64 of
 * `<frontend-api-host>$` — e.g. the public dev key decodes to
 * `amazed-cod-67.clerk.accounts.dev`, and a production `pk_live_` key
 * decodes to the instance's OWN domain (e.g. `clerk.acme.com`). clerk-js
 * is then loaded FROM that host (`https://<host>/npm/@clerk/clerk-js…`) and
 * all its API calls go there too. So the host the CSP / OAuth allow-list
 * must permit is encoded in the key itself — there is no fixed prod domain.
 *
 * Returns null for a missing or malformed key (caller falls back to the
 * static *.clerk.accounts.dev / *.clerk.com allow-list, which is all a
 * test key ever needs).
 */
export function clerkFrontendApiHost(publishableKey?: string | null): string | null {
  if (typeof publishableKey !== 'string') return null;
  const m = /^pk_(?:test|live)_([A-Za-z0-9+/=_-]+)$/.exec(publishableKey.trim());
  const body = m?.[1];
  if (!body) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(body, 'base64').toString('utf8');
  } catch {
    return null;
  }
  // The encoded value is the host with a trailing `$` delimiter. Guard that
  // what we decoded is a plain dotted hostname so a corrupt key can't smuggle
  // arbitrary CSP source tokens (spaces, schemes, paths) into the header.
  const host = decoded.replace(/\$+$/, '');
  return /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(host) ? host : null;
}

/**
 * CSP host-source tokens a Clerk instance needs beyond the static
 * `*.clerk.accounts.dev` / `*.clerk.com` entries: the exact prod Frontend
 * API host plus a wildcard on its parent domain (so the instance's own
 * `accounts.` / `img.` / `clerk.` subdomains are all covered). Empty for a
 * missing/malformed key, and empty for a test key whose host is already in
 * the static list — only a `pk_live_` instance on its own domain adds anything.
 */
export function clerkCspHostSources(publishableKey?: string | null): string[] {
  const host = clerkFrontendApiHost(publishableKey);
  if (!host) return [];
  if (host.endsWith('.clerk.accounts.dev') || host.endsWith('.clerk.com')) return [];
  const sources = [`https://${host}`];
  const parent = host.split('.').slice(1).join('.');
  // Only wildcard a real registrable parent (≥ 2 labels) — never a bare TLD.
  if (parent.split('.').length >= 2) sources.push(`https://*.${parent}`);
  return sources;
}

// ---- Content-Security-Policy ----------------------------------------------

/**
 * Clerk-compatible CSP for the packaged app. Scripts stay strict
 * (`'self'` + the Clerk/Cloudflare-Turnstile origins clerk-js needs —
 * no `'unsafe-inline'`/`'unsafe-eval'` because the bundle ships only
 * external module scripts). Styles allow `'unsafe-inline'` because the
 * UI uses inline style objects + the splash `<style>` block + Google
 * Fonts. `extraClerkHosts` are the prod Frontend API sources derived from
 * the publishable key (see {@link clerkCspHostSources}); empty for test keys.
 */
function buildCspDirectives(extraClerkHosts: readonly string[]): string {
  const extra = extraClerkHosts.length ? ` ${extraClerkHosts.join(' ')}` : '';
  return [
    "default-src 'self'",
    `script-src 'self' https://*.clerk.accounts.dev https://*.clerk.com https://challenges.cloudflare.com${extra}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    `img-src 'self' data: blob: https://img.clerk.com https://*.clerk.com${extra}`,
    "font-src 'self' data: https://fonts.gstatic.com",
    // challenges.cloudflare.com: Clerk's bot-protection (Turnstile) runs on
    // sign-up — Clerk's documented CSP needs it in connect-src too, not just
    // script/frame-src, or the captcha can fail and sign-up dead-ends.
    `connect-src 'self' https://*.clerk.accounts.dev https://*.clerk.com https://challenges.cloudflare.com${extra}`,
    "worker-src 'self' blob:",
    `frame-src https://*.clerk.accounts.dev https://*.clerk.com https://challenges.cloudflare.com${extra}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/**
 * Inject the CSP onto the app's OWN document responses only — either the
 * `file://` bundle (legacy / fallback path) or the loopback origin the
 * renderer is now served from (`http://127.0.0.1:<port>`, see
 * {@link ./loopback-server.ts}). Third-party responses (the Clerk CDN,
 * Google Fonts, and especially the OAuth popups that load
 * accounts.google.com / github.com) are left untouched — slapping our CSP
 * on them would break sign-in. Dev is skipped entirely: Vite's HMR needs
 * `'unsafe-eval'` + ws: and a strict policy would break the dev server.
 *
 * `clerkPublishableKey` is the renderer's `VITE_CLERK_PUBLISHABLE_KEY`. A
 * `pk_live_` key serves clerk-js from the instance's OWN domain, which the
 * static dev/test hosts don't cover — so without folding that host in here
 * the prod clerk-js script is CSP-blocked and `clerk.openSignIn()` silently
 * renders no modal. Test/absent keys add nothing (the static list suffices).
 *
 * `loopbackOrigin` is the origin of the in-app static server (or null when
 * the app fell back to `file://`). Under the loopback origin, `'self'` in
 * the directives resolves to `http://127.0.0.1:<port>` — exactly the app's
 * own scripts/styles served from `dist/`.
 */
export function installContentSecurityPolicy(
  session: Session,
  opts: {
    readonly isDev: boolean;
    readonly clerkPublishableKey?: string | null;
    readonly loopbackOrigin?: string | null;
  },
): void {
  if (opts.isDev) return;
  const directives = buildCspDirectives(clerkCspHostSources(opts.clerkPublishableKey));
  const loopbackOrigin = opts.loopbackOrigin ?? null;
  const isOwnDocument = (url: string): boolean =>
    url.startsWith('file://') || (!!loopbackOrigin && url.startsWith(`${loopbackOrigin}/`));
  session.webRequest.onHeadersReceived((details, callback) => {
    if (!isOwnDocument(details.url)) {
      callback({ responseHeaders: details.responseHeaders });
      return;
    }
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [directives],
      },
    });
  });
}

/**
 * Let the renderer capture the microphone for voice input.
 *
 * The renderer is a Chromium page, so `getUserMedia` needs the web-layer
 * `media` permission AND, on macOS, OS-level microphone access (TCC). The
 * macOS trap: without this, `getUserMedia` does NOT reject — it resolves with a
 * SILENT stream, so recordings transcribe to empty text and the UI shows a
 * misleading "No speech detected" (an auth failure would instead throw). On
 * macOS we ask the OS for mic access via the injected `askForMicAccess`
 * (the caller wires `systemPreferences.askForMediaAccess('microphone')` — kept
 * OUT of this module so the pure security helpers don't drag the electron
 * runtime into unit tests) and grant from its result; this also requires
 * `NSMicrophoneUsageDescription` in Info.plist (package.json#build.mac.extendInfo)
 * and, on a hardened-runtime signed build, the
 * `com.apple.security.device.audio-input` entitlement. Other platforms grant the
 * media request directly. Non-media requests keep the prior allow-by-default
 * behaviour.
 */
export interface MediaPermissionDeps {
  /** macOS only: request OS-level microphone access (returns granted?). Omit
   *  elsewhere — the media request is then granted directly. */
  readonly askForMicAccess?: () => Promise<boolean>;
}

export function installMediaPermissions(session: Session, deps: MediaPermissionDeps = {}): void {
  session.setPermissionRequestHandler((_wc, permission, callback) => {
    // getUserMedia surfaces as the `media` permission in the request handler
    // (`audioCapture`/`videoCapture` only appear in the check handler below).
    if (permission === 'media') {
      if (deps.askForMicAccess) {
        // Triggers the macOS mic prompt (first run) and reflects the user's
        // System Settings → Privacy → Microphone choice thereafter.
        void deps
          .askForMicAccess()
          .then((granted) => callback(granted))
          .catch(() => callback(false));
        return;
      }
      callback(true);
      return;
    }
    // Preserve Electron's prior default (no handler ⇒ grant) for the rest.
    callback(true);
  });
  // Chromium also CHECKS permission synchronously before requesting it; approve
  // so getUserMedia isn't short-circuited before the request handler runs.
  session.setPermissionCheckHandler(() => true);
}
