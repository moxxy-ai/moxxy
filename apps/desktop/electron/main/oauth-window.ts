/**
 * OAuth-popup + user-agent helpers for the Electron main process.
 *
 * Pure, testable units extracted from `index.ts`:
 *   - {@link cleanOAuthUserAgent} strips the Electron + app product tokens from
 *     a user-agent so Google's "this browser may not be secure" embedded-UA
 *     block doesn't reject the in-app sign-in popup.
 *   - {@link buildOAuthHostPatterns} builds the allow-list of origins whose
 *     `window.open()` popups (and top-frame OAuth redirects) are permitted,
 *     folding in a `pk_live_` instance's own Frontend API host and Account Portal.
 *
 * Both take their environment (the app name, the publishable key) as arguments
 * rather than reaching for `electron`/globals, so they have no side effects.
 */
import { clerkAccountPortalHost, clerkFrontendApiHost } from '@moxxy/desktop-host';

/** Strip the Electron + app product tokens from a user-agent, leaving a plain
 *  desktop-Chrome UA. Google blocks OAuth from "embedded" user-agents
 *  ("this browser may not be secure"); presenting a clean UA lets the in-app
 *  sign-in popup through. Harmless for our own + Clerk requests. `appName` is
 *  the product name (e.g. `app.getName()`). */
export function cleanOAuthUserAgent(ua: string, appName: string): string {
  const name = appName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return ua
    .replace(new RegExp(`\\s*${name}(?:/\\S+)?`, 'i'), '')
    .replace(/\s*Electron\/\S+/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Exact hosts allowed to take over the top frame during sign-in. */
export function buildOAuthHostPatterns(key: string): RegExp[] {
  const hosts = ['accounts.google.com', 'appleid.apple.com', 'github.com',
    clerkFrontendApiHost(key), clerkAccountPortalHost(key)];
  return hosts.flatMap(host => host ? [new RegExp('^https://' + host.replaceAll('.', '\\.') + '$')] : []);
}
