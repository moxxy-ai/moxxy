/**
 * OAuth-popup + user-agent helpers for the Electron main process.
 *
 * Pure, testable units extracted from `index.ts`:
 *   - {@link cleanOAuthUserAgent} strips the Electron + app product tokens from
 *     a user-agent so Google's "this browser may not be secure" embedded-UA
 *     block doesn't reject the in-app sign-in popup.
 *   - {@link buildOAuthHostPatterns} builds the allow-list of origins whose
 *     `window.open()` popups (and top-frame OAuth redirects) are permitted,
 *     folding in a `pk_live_` instance's own Frontend API host + parent domain.
 *
 * Both take their environment (the app name, the publishable key) as arguments
 * rather than reaching for `electron`/globals, so they have no side effects.
 */
import { clerkFrontendApiHost } from '@moxxy/desktop-host';

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

/**
 * Hosts where Clerk's OAuth popup is allowed to open. Anything else returns
 * `action: 'deny'` so we don't accidentally let arbitrary `window.open()` calls
 * spawn full Electron windows.
 *
 * A `pk_live_` instance runs OAuth through its OWN Frontend API host (e.g.
 * clerk.acme.com) and account portal (accounts.acme.com), neither covered by
 * the static set — so the exact host plus a wildcard on its parent domain are
 * appended. Test keys resolve to a host already in the static set, so they add
 * nothing.
 */
export function buildOAuthHostPatterns(clerkPublishableKey: string): RegExp[] {
  const patterns = [
    /^https:\/\/.*\.clerk\.accounts\.dev$/,
    /^https:\/\/.*\.clerk\.com$/,
    /^https:\/\/accounts\.google\.com$/,
    /^https:\/\/appleid\.apple\.com$/,
    /^https:\/\/github\.com$/,
  ];
  const clerkFapiHost = clerkFrontendApiHost(clerkPublishableKey);
  if (
    clerkFapiHost &&
    !clerkFapiHost.endsWith('.clerk.accounts.dev') &&
    !clerkFapiHost.endsWith('.clerk.com')
  ) {
    const reEsc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    patterns.push(new RegExp(`^https://${reEsc(clerkFapiHost)}$`));
    const parent = clerkFapiHost.split('.').slice(1).join('.');
    if (parent.split('.').length >= 2) {
      patterns.push(new RegExp(`^https://(?:[a-z0-9-]+\\.)+${reEsc(parent)}$`));
    }
  }
  return patterns;
}
